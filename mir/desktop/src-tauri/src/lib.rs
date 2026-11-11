mod builds;
mod chat;
pub mod conversation_import;
pub mod diagnostics;
pub mod files;
pub mod history;
pub mod model;
pub mod preferences;
mod server;
pub mod stream;
pub mod workspace;
pub use workspace::{Configuration, JobStatus, Listener, Settings};

use history::History;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::PathBuf,
    process::{Child, Command},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, String>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub run_id: Uuid,
    pub phase: String,
    pub model: Option<String>,
    pub url: Option<String>,
    pub logs: Vec<String>,
    pub error: Option<String>,
    pub running_settings: Option<Settings>,
    pub issue: Option<diagnostics::ServerIssue>,
}

struct Server {
    child: Option<Child>,
    settings: Option<Settings>,
    run: Uuid,
    phase: String,
    model: Option<String>,
    url: Option<String>,
    logs: VecDeque<String>,
    error: Option<String>,
    diagnostics: diagnostics::Diagnostics,
}

pub struct Runtime {
    launcher: PathBuf,
    bash: PathBuf,
    server: Arc<Mutex<Server>>,
    client: reqwest::Client,
    active: Mutex<Generation>,
    model_details: Mutex<Option<model::ServerDetails>>,
    pub history: History,
    pub preferences: preferences::Preferences,
    workspace: Mutex<workspace::Workspace>,
    job: Arc<Mutex<workspace::Job>>,
    _instance: File,
}

#[derive(Default)]
struct Generation {
    current: Option<(Uuid, CancellationToken)>,
    cancelled: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: Uuid,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub options: ChatOptions,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatOptions {
    pub reasoning: Option<String>,
    pub effort: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl Runtime {
    pub fn new(launcher: PathBuf, data: PathBuf) -> Result<Self> {
        if !launcher.is_file() {
            return Err(format!("Launcher not found: {}", launcher.display()));
        }
        let bash = [std::env::var_os("MIR_DESKTOP_BASH").map(PathBuf::from),
            Some(PathBuf::from("bash")),
            Some(PathBuf::from("/opt/homebrew/bin/bash")),
            Some(PathBuf::from("/usr/local/bin/bash"))]
            .into_iter().flatten().find(|path| Command::new(path)
                .args(["-c", "(( BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) ))"])
                .status().is_ok_and(|status| status.success()))
            .ok_or("Mir.cpp requires Bash 4.4 or newer. Install a current Bash and retry.")?;
        let history = History::new(data.join("conversations"))?;
        let instance = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(data.join("session.lock"))
            .map_err(|e| e.to_string())?;
        // Keep the inode and descriptor for the whole application lifetime.
        if unsafe { libc::flock(instance.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Another Mir.cpp desktop session is already open.".into());
        }
        Ok(Self {
            launcher,
            bash,
            history,
            preferences: preferences::Preferences::new(data.clone()),
            _instance: instance,
            workspace: Mutex::new(workspace::Workspace::default()),
            job: Arc::new(Mutex::new(workspace::Job::default())),
            server: Arc::new(Mutex::new(Server {
                child: None,
                settings: None,
                run: Uuid::new_v4(),
                phase: "stopped".into(),
                model: None,
                url: None,
                logs: VecDeque::new(),
                error: None,
                diagnostics: diagnostics::Diagnostics::default(),
            })),
            active: Mutex::new(Generation::default()),
            model_details: Mutex::new(None),
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.cancel_build();
        let _ = self.stop();
    }
}

pub fn default_data_dir() -> Result<PathBuf> {
    let root = std::env::var_os("XDG_DATA_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .ok_or("HOME or XDG_DATA_HOME must be configured.")?;
    if !root.is_absolute() {
        return Err("The desktop data directory must be absolute.".into());
    }
    Ok(root.join("mir.cpp/desktop"))
}
