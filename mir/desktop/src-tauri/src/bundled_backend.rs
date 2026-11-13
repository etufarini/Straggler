//! Packaging diagnostics use isolated configuration and data.

use crate::Result;
use serde::Serialize;
use std::{
    ffi::OsString,
    fs::File,
    io::{Read, Seek, SeekFrom},
    net::TcpListener,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub operation: String,
    pub success: bool,
    pub logs: String,
    pub error: Option<String>,
}

pub fn bundled_server(executable: &Path) -> Result<PathBuf> {
    let server = executable
        .parent()
        .ok_or("The application has no executable directory.")?
        .join("mir-llama-server");
    if !server.is_file() {
        return Err("The bundled llama-server is missing. Rebuild the packaging check.".into());
    }
    Ok(server)
}

struct Process {
    child: Child,
    log: File,
}

impl Process {
    fn spawn(server: &Path, arguments: &[OsString]) -> Result<Self> {
        let log =
            tempfile::tempfile().map_err(|e| format!("Cannot create the backend log: {e}"))?;
        let mut command = Command::new(server);
        // Diagnostic runs must not inherit user-supplied server arguments.
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("LLAMA_ARG_") {
                command.env_remove(key);
            }
        }
        let child = command
            .args(arguments)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log.try_clone().map_err(|e| e.to_string())?)
            .spawn()
            .map_err(|e| format!("Cannot execute the bundled llama-server: {e}"))?;
        Ok(Self { child, log })
    }

    async fn stop(&mut self, confirm_force: &mut impl FnMut(u32) -> bool) -> Result<()> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return Ok(());
        }
        // An unreaped owned child reserves its PID. Never signal a discovered listener.
        let pid = self.child.id();
        if unsafe { libc::kill(-(pid as i32), libc::SIGTERM) } != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::ESRCH) {
                return Err(format!("Cannot stop backend PID {pid}: {error}"));
            }
        }
        let mut deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if self.child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Ok(());
            }
            if Instant::now() >= deadline {
                if confirm_force(pid) {
                    // The child is still owned and unreaped, including across the confirmation.
                    if self.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                        if unsafe { libc::kill(-(pid as i32), libc::SIGKILL) } != 0 {
                            let error = std::io::Error::last_os_error();
                            if error.raw_os_error() != Some(libc::ESRCH) {
                                return Err(format!(
                                    "Cannot force stop backend PID {pid}: {error}"
                                ));
                            }
                        }
                        self.child.wait().map_err(|e| e.to_string())?;
                    }
                    return Ok(());
                }
                // Refusing SIGKILL keeps ownership until exit or a later confirmation.
                deadline = Instant::now() + Duration::from_secs(5);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    fn finish(mut self, operation: &str, result: Result<()>) -> Check {
        let logs = (|| -> std::io::Result<String> {
            let length = self.log.metadata()?.len();
            self.log
                .seek(SeekFrom::Start(length.saturating_sub(32768)))?;
            let mut bytes = Vec::new();
            self.log.read_to_end(&mut bytes)?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        })();
        let (logs, result) = match logs {
            Ok(logs) => (logs, result),
            Err(error) => (
                String::new(),
                Err(format!(
                    "Cannot read backend diagnostics: {error}; operation: {result:?}"
                )),
            ),
        };
        Check {
            operation: operation.into(),
            success: result.is_ok(),
            logs,
            error: result.err(),
        }
    }
}

fn failed(operation: &str, error: String) -> Check {
    Check {
        operation: operation.into(),
        success: false,
        logs: String::new(),
        error: Some(error),
    }
}

pub async fn check_command(
    server: &Path,
    flag: &str,
    cancelled: &AtomicBool,
    timeout: Duration,
    confirm_force: &mut impl FnMut(u32) -> bool,
) -> Check {
    if !matches!(flag, "--version" | "--help") {
        return failed(flag, "Unsupported packaging diagnostic.".into());
    }
    let mut process = match Process::spawn(server, &[flag.into()]) {
        Ok(process) => process,
        Err(error) => return failed(flag, error),
    };
    let deadline = Instant::now() + timeout;
    let result = loop {
        match process.child.try_wait() {
            Ok(Some(exit)) => {
                break if exit.success() {
                    Ok(())
                } else {
                    Err(format!("Backend diagnostic exited ({exit})."))
                }
            }
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        if cancelled.load(Ordering::Relaxed) {
            break Err("Backend check cancelled.".into());
        }
        if Instant::now() >= deadline {
            break Err("Backend diagnostic timed out.".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let cleanup = process.stop(confirm_force).await;
    process.finish(flag, cleanup.and(result))
}

/// Optional integration diagnostic: load a selected model on CPU without generation.
pub async fn check_model(
    server: &Path,
    model: &Path,
    cancelled: &AtomicBool,
    timeout: Duration,
    confirm_force: &mut impl FnMut(u32) -> bool,
) -> Check {
    let operation = "model-load-and-stop";
    let client = match reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(1))
        .build()
    {
        Ok(client) => client,
        Err(error) => return failed(operation, error.to_string()),
    };
    let reservation = match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener,
        Err(error) => {
            return failed(
                operation,
                format!("Cannot reserve a loopback port: {error}"),
            )
        }
    };
    let port = match reservation.local_addr() {
        Ok(address) => address.port(),
        Err(error) => return failed(operation, error.to_string()),
    };
    let arguments = [
        "--model".into(),
        model.as_os_str().to_owned(),
        "--host".into(),
        "127.0.0.1".into(),
        "--port".into(),
        port.to_string().into(),
        "--gpu-layers".into(),
        "0".into(),
        "--ctx-size".into(),
        "512".into(),
        "--parallel".into(),
        "1".into(),
        "--no-warmup".into(),
    ];
    drop(reservation);
    let mut process = match Process::spawn(server, &arguments) {
        Ok(process) => process,
        Err(error) => return failed(operation, error),
    };
    let deadline = Instant::now() + timeout;
    let result = loop {
        match process.child.try_wait() {
            Ok(Some(exit)) => {
                break Err(format!("Backend exited before model readiness ({exit})."))
            }
            Err(error) => break Err(error.to_string()),
            Ok(None) => {}
        }
        if cancelled.load(Ordering::Relaxed) {
            break Err("Model check cancelled.".into());
        }
        if Instant::now() >= deadline {
            break Err("Model loading timed out. Check the backend log.".into());
        }
        if let Ok(response) = client
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .await
        {
            if response.status().is_success() {
                // Readiness is an integration observation, not evidence of generated output.
                break Ok(());
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    let cleanup = process.stop(confirm_force).await;
    process.finish(operation, cleanup.and(result))
}
