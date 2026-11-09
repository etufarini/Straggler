use crate::workspace::{BridgeRequest, Job, JobStatus};
use crate::{Result, Runtime};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::process::CommandExt,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

impl Runtime {
    pub fn start_build(&self, tag: String, backend: String, jobs: String) -> Result<()> {
        let config = self.inspect()?;
        if !config.backends.iter().any(|item| item.id == backend) {
            return Err("Invalid build backend for this platform.".into());
        }
        if self
            .server
            .lock()
            .map_err(|e| e.to_string())?
            .child
            .is_some()
        {
            return Err("Stop the server before installing or changing its build.".into());
        }
        let mut job = self.job.lock().map_err(|e| e.to_string())?;
        if job.child.is_some() || job.phase == "running" {
            return Err("A build is already running.".into());
        }
        let mut child = Command::new(&self.bash)
            .arg(&self.launcher)
            .args(["--desktop", "build", &tag, &backend, &jobs])
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut input) = child.stdin.take() {
            input
                .write_all(
                    &serde_json::to_vec(&BridgeRequest::from(&config))
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
        }
        let stdout = child.stdout.take().ok_or("Build output is unavailable.")?;
        let stderr = child.stderr.take().ok_or("Build log is unavailable.")?;
        let id = job.id + 1;
        *job = Job {
            child: Some(child),
            id,
            phase: "running".into(),
            ..Job::default()
        };
        read_job(self.job.clone(), id, stdout);
        read_job(self.job.clone(), id, stderr);
        Ok(())
    }

    pub fn job_status(&self) -> Result<JobStatus> {
        let activated = {
            let mut job = self.job.lock().map_err(|e| e.to_string())?;
            if let Some(child) = &mut job.child {
                if let Some(exit) = child.try_wait().map_err(|e| e.to_string())? {
                    job.child = None;
                    job.success = exit.success();
                    if !exit.success() {
                        job.phase = "failed".into();
                        job.error = Some(
                            "Build failed. The previous installation was kept; check the log."
                                .into(),
                        );
                    }
                }
            }
            if job.success && job.activated.is_some() {
                job.phase = "ready".into();
                job.success = false;
                job.activated.take()
            } else {
                None
            }
        };
        if let Some(path) = activated {
            let mut workspace = self.workspace.lock().map_err(|e| e.to_string())?;
            if let Some(config) = &mut workspace.configuration {
                config.llama_dir = path;
            }
        }
        let job = self.job.lock().map_err(|e| e.to_string())?;
        Ok(JobStatus {
            phase: job.phase.clone(),
            logs: job.logs.iter().cloned().collect(),
            error: job.error.clone(),
        })
    }

    pub fn cancel_build(&self) -> Result<()> {
        let mut child = {
            let mut job = self.job.lock().map_err(|e| e.to_string())?;
            let Some(child) = job.child.take() else {
                return Ok(());
            };
            job.phase = "stopping".into();
            child
        };
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().map_err(|e| e.to_string())?.is_none() {
            if Instant::now() >= deadline {
                let mut job = self.job.lock().map_err(|e| e.to_string())?;
                job.child = Some(child);
                job.phase = "running".into();
                return Err("The build has not stopped after SIGTERM. Retry cancel; no force signal was sent.".into());
            }
            thread::sleep(Duration::from_millis(50));
        }
        let mut job = self.job.lock().map_err(|e| e.to_string())?;
        job.phase = "canceled".into();
        job.success = false;
        Ok(())
    }
}

fn read_job(job: Arc<Mutex<Job>>, id: u64, pipe: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        loop {
            let mut bytes = Vec::new();
            if matches!(
                std::io::Read::take(&mut reader, 16384).read_until(b'\n', &mut bytes),
                Ok(0) | Err(_)
            ) {
                break;
            }
            let line = String::from_utf8_lossy(&bytes).trim_end().to_owned();
            let Ok(mut job) = job.lock() else {
                break;
            };
            if job.id != id {
                break;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value["mirBuild"] == 1 {
                    job.activated = value["llamaDir"].as_str().map(str::to_owned);
                    continue;
                }
            }
            if job.logs.len() == 300 {
                job.logs.pop_front();
            }
            job.logs.push_back(line);
        }
    });
}
