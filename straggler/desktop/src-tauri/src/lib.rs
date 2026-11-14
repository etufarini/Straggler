pub mod attachments;
pub mod bundled_backend;
mod chat;
pub mod configuration;
pub mod conversation_import;
pub mod diagnostics;
pub mod files;
pub mod history;
pub mod huggingface;
pub mod model;
pub mod model_access;
pub mod platform;
pub mod preferences;
pub mod projects;
mod server;
pub mod stream;
pub mod temporary;
pub mod tokens;
pub mod workspace;
pub use workspace::{Configuration, Listener, Settings};

use history::History;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    os::{fd::AsRawFd, unix::fs::OpenOptionsExt},
    path::PathBuf,
    process::Child,
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
    temporary: bool,
}

pub struct Runtime {
    pub hugging_face: huggingface::HuggingFace,
    native: configuration::native::NativeConfiguration,
    server: Arc<Mutex<Server>>,
    client: reqwest::Client,
    active: Mutex<Generation>,
    model_details: Mutex<Option<model::ServerDetails>>,
    pub history: History,
    pub projects: projects::Projects,
    pub preferences: preferences::Preferences,
    workspace: Mutex<workspace::Workspace>,
    temporary: Mutex<Option<temporary::TemporaryChat>>,
    _instance: File,
}

#[derive(Default)]
struct Generation {
    current: Option<(Uuid, CancellationToken)>,
    cancelled: Option<Uuid>,
    conversation_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: Uuid,
    #[serde(default)]
    pub conversation_id: Option<Uuid>,
    #[serde(default)]
    pub temporary_id: Option<Uuid>,
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
    #[cfg(all(feature = "native-tests", debug_assertions))]
    pub fn test_data_dir(&self) -> PathBuf {
        self.native.store.environment.data.join("desktop")
    }

    pub fn new(
        environment: configuration::environment::Environment,
        data: PathBuf,
    ) -> Result<Self> {
        let hugging_face = huggingface::HuggingFace::new(&data.join("huggingface"))?;
        #[cfg(all(feature = "native-tests", debug_assertions))]
        let hugging_face = match environment.value("STRAGGLER_TEST_HF_ENDPOINT") {
            Some(endpoint) => huggingface::HuggingFace::with_hub(
                &data.join("huggingface"),
                huggingface::api::HubClient::loopback_fixture(
                    Arc::new(huggingface::credentials::MemoryTokenStore::default()),
                    &endpoint,
                )?,
            )?,
            None => hugging_face,
        };
        let native = configuration::native::NativeConfiguration::new(environment)?;
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
            return Err("Another Straggler desktop session is already open.".into());
        }
        let projects = projects::Projects::new(data.join("projects"), &history)?;
        Ok(Self {
            hugging_face,
            native,
            history,
            projects,
            preferences: preferences::Preferences::new(data.clone()),
            _instance: instance,
            workspace: Mutex::new(workspace::Workspace::default()),
            temporary: Mutex::new(None),
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
                temporary: false,
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

impl Runtime {
    pub fn shutdown(&self) -> Result<()> {
        // Paused .part files and their pinned identities survive the process exit.
        let downloads = self.hugging_face.downloads.pause_all();
        self.native.cancel_discovery()?;
        self.stop()?;
        downloads
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
