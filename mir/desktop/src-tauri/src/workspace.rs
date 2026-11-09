use crate::{Result, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    io::Write,
    process::{Child, Command, Stdio},
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub model: String,
    pub context: String,
    pub port: String,
    pub device: String,
    pub threads: String,
    pub gpu_layers: String,
    pub prompt_processing: String,
    pub cache_type_k: String,
    pub cache_type_v: String,
    pub split_mode: String,
    pub tensor_split: String,
    pub fit_target: String,
    pub temperature: String,
    pub top_p: String,
    pub top_k: String,
    pub min_p: String,
    pub repeat_penalty: String,
    pub presence_penalty: String,
    pub frequency_penalty: String,
    pub seed: String,
    pub max_tokens: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuildBackend {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Model {
    pub path: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Listener {
    pub pid: u32,
    pub identity: String,
    pub details: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Configuration {
    pub llama_dir: String,
    pub models_dir: String,
    pub server_available: bool,
    pub port: u16,
    pub port_status: String,
    pub warning: String,
    pub settings: Settings,
    pub generation_preset: String,
    pub models: Vec<Model>,
    pub devices: Vec<Device>,
    pub listeners: Vec<Listener>,
    pub memory: Value,
    pub build: Value,
    pub profiles: Vec<String>,
    pub backends: Vec<BuildBackend>,
    pub capabilities: Value,
    pub presets: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub current_profile: Option<String>,
    #[serde(default)]
    pub modified: bool,
    #[serde(default)]
    pub restart_required: bool,
    #[serde(default)]
    pub saved_settings: Option<Settings>,
}

#[derive(Default)]
pub(crate) struct Workspace {
    pub(crate) configuration: Option<Configuration>,
    profile: Option<String>,
    saved: Option<Settings>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Settings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llama_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models_dir: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub targets: Vec<Listener>,
}

impl From<&Configuration> for BridgeRequest {
    fn from(value: &Configuration) -> Self {
        Self {
            settings: Some(value.settings.clone()),
            llama_dir: Some(value.llama_dir.clone()),
            models_dir: Some(value.models_dir.clone()),
            targets: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub phase: String,
    pub logs: Vec<String>,
    pub error: Option<String>,
}

pub(crate) struct Job {
    pub(crate) child: Option<Child>,
    pub(crate) id: u64,
    pub(crate) phase: String,
    pub(crate) logs: VecDeque<String>,
    pub(crate) error: Option<String>,
    pub(crate) activated: Option<String>,
    pub(crate) success: bool,
}
impl Default for Job {
    fn default() -> Self {
        Self {
            child: None,
            id: 0,
            phase: "idle".into(),
            logs: VecDeque::new(),
            error: None,
            activated: None,
            success: false,
        }
    }
}

impl Runtime {
    pub(crate) fn job_busy(&self) -> Result<bool> {
        let job = self.job.lock().map_err(|e| e.to_string())?;
        Ok(job.child.is_some() || matches!(job.phase.as_str(), "running" | "stopping"))
    }

    pub(crate) fn bridge(
        &self,
        action: &str,
        arguments: &[String],
        request: &BridgeRequest,
    ) -> Result<Value> {
        let mut child = Command::new(&self.bash)
            .arg(&self.launcher)
            .args(["--desktop", action])
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = serde_json::to_vec(request).map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&input).map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        if action == "latest" {
            return Ok(json!({"tag": String::from_utf8_lossy(&output.stdout).trim()}));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|e| format!("Invalid launcher response: {e}"))
    }

    pub fn inspect(&self) -> Result<Configuration> {
        self.configure_action("inspect", &[], None)
    }

    pub fn configure(&self, settings: Settings) -> Result<Configuration> {
        self.configure_action("inspect", &[], Some(settings))
    }

    pub fn workspace_action(
        &self,
        action: &str,
        arguments: Vec<String>,
        targets: Vec<Listener>,
    ) -> Result<Value> {
        match action {
            "load-profile" | "save-profile" | "delete-profile" | "set-path" | "restore"
            => {
                if (action == "restore"
                    || (action == "set-path"
                        && arguments.first().map(String::as_str) == Some("llama")))
                    && self
                        .server
                        .lock()
                        .map_err(|e| e.to_string())?
                        .child
                        .is_some()
                {
                    return Err("Stop the server before restoring its build.".into());
                }
                serde_json::to_value(self.configure_action(action, &arguments, None)?)
                    .map_err(|e| e.to_string())
            }
            "stop-listeners" | "browse" | "build-plan" | "latest" | "build-log" => {
                if action == "stop-listeners" {
                    let state = self.server.lock().map_err(|e| e.to_string())?;
                    if state.child.is_some() {
                        return Err("Use Stop server for the server started by this app.".into());
                    }
                    if arguments.len() != 1 || !matches!(arguments[0].as_str(), "TERM" | "KILL") {
                        return Err("Invalid listener shutdown request.".into());
                    }
                }
                let config = self.inspect()?;
                let mut request = BridgeRequest::from(&config);
                request.targets = targets;
                let value = self.bridge(action, &arguments, &request)?;
                if action == "stop-listeners" {
                    return serde_json::to_value(self.inspect()?).map_err(|e| e.to_string());
                }
                Ok(value)
            }
            _ => Err("Unknown configuration operation.".into()),
        }
    }

    fn configure_action(
        &self,
        action: &str,
        arguments: &[String],
        settings: Option<Settings>,
    ) -> Result<Configuration> {
        let mut workspace = self.workspace.lock().map_err(|e| e.to_string())?;
        let mut request = workspace
            .configuration
            .as_ref()
            .map(BridgeRequest::from)
            .unwrap_or_default();
        if let Some(settings) = settings {
            request.settings = Some(settings);
        }
        let mut next: Configuration =
            serde_json::from_value(self.bridge(action, arguments, &request)?)
                .map_err(|e| e.to_string())?;
        match action {
            "load-profile" | "save-profile" => {
                workspace.profile = arguments.first().cloned();
                workspace.saved = Some(next.settings.clone());
            }
            "delete-profile" if workspace.profile.as_ref() == arguments.first() => {
                workspace.profile = None;
                workspace.saved = None;
            }
            _ => {}
        }
        next.current_profile = workspace.profile.clone();
        next.saved_settings = workspace.saved.clone();
        next.modified = workspace
            .saved
            .as_ref()
            .is_some_and(|saved| saved != &next.settings);
        let server = self.server.lock().map_err(|e| e.to_string())?;
        next.restart_required = server.child.is_some()
            && server
                .settings
                .as_ref()
                .is_some_and(|running| running != &next.settings);
        workspace.configuration = Some(next.clone());
        Ok(next)
    }

}
