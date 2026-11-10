use crate::{workspace, Result, Runtime, Server, Status};
use serde_json::Value;
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    os::unix::process::CommandExt,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

impl Runtime {
    pub fn start(&self, model: String) -> Result<()> {
        if self.job_busy()? {
            return Err(
                "Wait for the build to finish or cancel it before launching the server.".into(),
            );
        }
        let config = self.inspect()?;
        let mut request = workspace::BridgeRequest::from(&config);
        let mut settings = config.settings;
        settings.model = model.clone();
        request.settings = Some(settings.clone());
        let mut state = self.server.lock().map_err(|e| e.to_string())?;
        refresh_child(&mut state)?;
        if state.child.is_some() || state.phase == "stopping" {
            return Err("Stop the current server before loading another model.".into());
        }
        let mut child = Command::new(&self.bash)
            .arg(&self.launcher)
            .args(["--desktop", "start", &model])
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Cannot start llama.cpp: {e}"))?;
        if let Some(mut input) = child.stdin.take() {
            std::io::Write::write_all(
                &mut input,
                &serde_json::to_vec(&request).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        let run = Uuid::new_v4();
        let stdout = child.stdout.take().ok_or("Server output is unavailable.")?;
        let stderr = child.stderr.take().ok_or("Server log is unavailable.")?;
        *state = Server {
            child: Some(child),
            settings: Some(settings),
            run,
            phase: "loading".into(),
            model: Some(model),
            url: None,
            logs: VecDeque::new(),
            error: None,
            diagnostics: crate::diagnostics::Diagnostics::default(),
        };
        read_log(self.server.clone(), run, stdout, true);
        read_log(self.server.clone(), run, stderr, false);
        Ok(())
    }

    pub async fn status(&self) -> Result<Status> {
        let (run, url) = {
            let mut state = self.server.lock().map_err(|e| e.to_string())?;
            refresh_child(&mut state)?;
            (
                state.run,
                if state.diagnostics.issue.is_none()
                    && matches!(state.phase.as_str(), "loading" | "ready")
                {
                    state.url.clone()
                } else {
                    None
                },
            )
        };
        if let Some(url) = url {
            let ready = self
                .client
                .get(format!("{url}/health"))
                .timeout(Duration::from_secs(2))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            let mut state = self.server.lock().map_err(|e| e.to_string())?;
            refresh_child(&mut state)?;
            if state.run == run && matches!(state.phase.as_str(), "loading" | "ready") {
                state.phase = if ready { "ready" } else { "loading" }.into();
            }
        }
        let state = self.server.lock().map_err(|e| e.to_string())?;
        Ok(Status {
            run_id: state.run,
            phase: if state.diagnostics.issue.is_some()
                && matches!(state.phase.as_str(), "loading" | "ready")
            {
                "needs-restart".into()
            } else {
                state.phase.clone()
            },
            model: state.model.clone(),
            url: state.url.clone(),
            logs: state.logs.iter().cloned().collect(),
            error: state.error.clone(),
            running_settings: state.settings.clone(),
            issue: state.diagnostics.issue.clone(),
        })
    }

    pub fn stop(&self) -> Result<()> {
        if let Some((_, token)) = self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .current
            .as_ref()
        {
            token.cancel();
        }
        let mut child = {
            let mut state = self.server.lock().map_err(|e| e.to_string())?;
            refresh_child(&mut state)?;
            if state.phase == "stopping" {
                return Err("Server shutdown is already in progress.".into());
            }
            let Some(child) = state.child.take() else {
                return Ok(());
            };
            state.phase = "stopping".into();
            child
        };
        // An unreaped owned child keeps this PID reserved. Its separate process
        // group also contains probes running before the bridge execs the server.
        let signal = unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM) };
        let signal_error = std::io::Error::last_os_error();
        let deadline = Instant::now() + Duration::from_secs(5);
        let result = loop {
            match child.try_wait() {
                Ok(Some(_)) => break Ok(()),
                Err(e) => break Err(format!("Cannot inspect server shutdown: {e}")),
                Ok(None) if signal != 0 => break Err(format!("Cannot stop the server: {signal_error}")),
                Ok(None) if Instant::now() >= deadline => break Err("The server has not stopped after SIGTERM. It is still supervised; retry Stop server. No force signal was sent.".into()),
                _ => thread::sleep(Duration::from_millis(50)),
            }
        };
        let mut state = self.server.lock().map_err(|e| e.to_string())?;
        if result.is_ok() {
            state.phase = "stopped".into();
            state.settings = None;
            state.url = None;
        } else {
            state.child = Some(child);
            state.phase = "loading".into();
        }
        result
    }
}

fn refresh_child(state: &mut Server) -> Result<()> {
    if let Some(child) = &mut state.child {
        if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
            state.child = None;
            state.settings = None;
            state.url = None;
            state.phase = if exit.success() { "stopped" } else { "error" }.into();
            if !exit.success() {
                let error = format!("llama.cpp exited ({exit}). Check the server log.");
                state.diagnostics.process_failed(&error);
                state.error = Some(error);
            }
        }
    }
    Ok(())
}

fn read_log(
    server: Arc<Mutex<Server>>,
    run: Uuid,
    pipe: impl std::io::Read + Send + 'static,
    metadata: bool,
) {
    thread::spawn(move || {
        let mut first = metadata;
        // read_until bounds retained log lines, including output without newlines.
        let mut reader = BufReader::new(pipe);
        loop {
            let mut bytes = Vec::new();
            let result = std::io::Read::take(&mut reader, 16384).read_until(b'\n', &mut bytes);
            if matches!(result, Ok(0) | Err(_)) {
                break;
            }
            let line = String::from_utf8_lossy(&bytes).trim_end().to_owned();
            let Ok(mut state) = server.lock() else {
                break;
            };
            if state.run != run {
                break;
            }
            if first {
                first = false;
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if value["mirDesktop"] == 1 {
                        if let Some(url) = value["url"].as_str().filter(|url| valid_url(url)) {
                            state.url = Some(url.into());
                        }
                        continue;
                    }
                }
            }
            if state.logs.len() == 300 {
                state.logs.pop_front();
            }
            state.diagnostics.observe_log(&line);
            state.logs.push_back(line);
        }
    });
}

fn valid_url(url: &str) -> bool {
    url.strip_prefix("http://127.0.0.1:")
        .and_then(|port| port.parse::<u16>().ok())
        .is_some_and(|port| port > 0)
}
