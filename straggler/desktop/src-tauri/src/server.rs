use crate::{workspace::configuration_paths, Result, Runtime, Server, Status};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    os::unix::process::CommandExt,
    process::Stdio,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

impl Runtime {
    pub fn start(&self, model: String) -> Result<()> {
        let config = self.inspect()?;
        let paths = configuration_paths(&config);
        let mut settings = config.settings;
        settings.model = model.clone();
        let settings = settings.validated()?;
        let (executable, mut arguments) = self.native.launch(&paths, &settings)?;
        let temporary = self.temporary.lock().map_err(|e| e.to_string())?.is_some();
        if temporary {
            arguments.extend(self.native.temporary_arguments()?);
        }
        let mut state = self.server.lock().map_err(|e| e.to_string())?;
        refresh_child(&mut state)?;
        if state.child.is_some() || state.phase == "stopping" {
            return Err("Stop the current server before loading another model.".into());
        }
        if self.native.is_closing() {
            return Err("Straggler is closing.".into());
        }
        let mut child = self
            .native
            .store
            .environment
            .command(&executable)
            .args(&arguments)
            .process_group(0)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Cannot start llama.cpp: {error}"))?;
        let run = Uuid::new_v4();
        let stdout = child.stdout.take().ok_or("Server output is unavailable.")?;
        let stderr = child.stderr.take().ok_or("Server log is unavailable.")?;
        let url = format!("http://127.0.0.1:{}", settings.port);
        let resume_model = model.clone();
        *state = Server {
            child: Some(child),
            settings: Some(settings),
            run,
            phase: "loading".into(),
            model: Some(model),
            url: Some(url),
            logs: VecDeque::new(),
            error: None,
            diagnostics: crate::diagnostics::Diagnostics::default(),
            temporary,
            jinja: arguments.iter().any(|argument| argument == "--jinja"),
        };
        drop(state);
        if let Some(chat) = self.temporary.lock().map_err(|e| e.to_string())?.as_mut() {
            chat.slot = None;
            chat.ending = false;
            chat.resume_model = Some(resume_model);
        }
        read_log(self.server.clone(), run, stdout);
        read_log(self.server.clone(), run, stderr);
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
        // group belongs to this supervised server alone.
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

fn read_log(server: Arc<Mutex<Server>>, run: Uuid, pipe: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
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
            if state.temporary {
                // An external backend may ignore log flags. Never retain its raw private output.
                continue;
            }
            if state.logs.len() == 300 {
                state.logs.pop_front();
            }
            state.diagnostics.observe_log(&line);
            state.logs.push_back(line);
        }
    });
}
