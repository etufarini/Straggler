use super::{
    capabilities,
    environment::Environment,
    models, settings,
    storage::{executable, readable_model, server_path, Paths, Store},
};
use crate::{
    platform,
    workspace::{Configuration, Device, Settings},
    Result,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[derive(Default)]
struct Discovery {
    source: Option<(PathBuf, Option<std::time::SystemTime>, u64, bool)>,
    help: String,
    devices: Vec<Device>,
    devices_reported: bool,
    warning: String,
    valid: bool,
}

pub struct NativeConfiguration {
    pub store: Store,
    pub model_access: crate::model_access::ModelAccess,
    discovery: Mutex<Discovery>,
    closing: AtomicBool,
}

impl NativeConfiguration {
    pub fn new(environment: Environment) -> Result<Self> {
        let model_access = crate::model_access::ModelAccess::restore(&environment.data);
        Ok(Self {
            store: Store::new(environment)?,
            model_access,
            discovery: Mutex::new(Discovery::default()),
            closing: AtomicBool::new(false),
        })
    }

    pub fn cancel_discovery(&self) -> Result<()> {
        self.closing.store(true, Ordering::Relaxed);
        // The discovery worker owns its probes and reaps them before releasing this lock.
        drop(self.discovery.lock().map_err(|error| error.to_string())?);
        Ok(())
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Relaxed)
    }

    pub fn server(&self, paths: &Paths) -> Option<PathBuf> {
        if paths.llama.is_empty() {
            self.store.environment.bundled_server.clone()
        } else {
            Some(server_path(&paths.llama))
        }
    }

    fn verify_bundled(&self, server: &Path) -> Result<()> {
        let manifest = bundled_manifest();
        let commit = manifest["commit"]
            .as_str()
            .ok_or("The bundled backend manifest has no source commit.")?;
        let version =
            capabilities::probe(&self.store.environment, server, "--version", &self.closing)?;
        if !commit
            .get(..7)
            .is_some_and(|prefix| version.contains(prefix))
        {
            let remedy = if cfg!(feature = "app-store") {
                "Reinstall Mir.cpp from the App Store."
            } else {
                "Reinstall the application or select an external build."
            };
            return Err(format!(
                "The bundled backend does not report the pinned source commit. {remedy}"
            ));
        }
        Ok(())
    }

    pub fn snapshot(&self, paths: &Paths, mut settings: Settings) -> Result<Configuration> {
        if self.is_closing() {
            return Err("Mir.cpp is closing.".into());
        }
        let mut warning = paths.warning.clone();
        let access_warning = self.model_access.warning();
        if !access_warning.is_empty() {
            warning.push_str(&format!("\n{access_warning}"));
        }
        let discovered_models = match models::discover(Path::new(&paths.models)) {
            Ok(models) => models,
            Err(error) => {
                warning.push_str(&format!("\n{error}"));
                Vec::new()
            }
        };
        if settings.model.is_empty() {
            settings.model = discovered_models
                .first()
                .map(|model| model.path.clone())
                .unwrap_or_default();
        }
        let server = self.server(paths);
        let metadata = server.as_ref().and_then(|server| server.metadata().ok());
        let source = server.as_ref().map(|path| {
            (
                path.clone(),
                metadata
                    .as_ref()
                    .and_then(|metadata| metadata.modified().ok()),
                metadata.as_ref().map_or(0, |metadata| metadata.len()),
                executable(path),
            )
        });
        let available = server.as_ref().is_some_and(|server| executable(server));
        let mut discovery = self.discovery.lock().map_err(|error| error.to_string())?;
        if source != discovery.source {
            *discovery = Discovery {
                source,
                valid: available,
                ..Discovery::default()
            };
            if let Some(server) = server.as_ref().filter(|_| available) {
                let environment = &self.store.environment;
                match capabilities::probe(environment, server, "--help", &self.closing) {
                    Ok(help) => discovery.help = help,
                    Err(error) => discovery
                        .warning
                        .push_str(&format!("Cannot inspect server options. {error}")),
                }
                if let Ok(output) =
                    capabilities::probe(environment, server, "--list-devices", &self.closing)
                {
                    discovery.devices_reported = output.contains("Available devices:");
                    discovery.devices = capabilities::devices(&output);
                }
                if paths.llama.is_empty() {
                    if let Err(error) = self.verify_bundled(server) {
                        discovery.valid = false;
                        discovery.warning.push_str(&format!("\n{error}"));
                    }
                }
            }
        }
        if self.is_closing() {
            return Err("Backend discovery cancelled.".into());
        }
        if !discovery.warning.is_empty() {
            warning.push_str(&format!("\n{}", discovery.warning));
        }
        let port = settings
            .port
            .parse::<u16>()
            .map_err(|error| error.to_string())?;
        let inspected = match platform::inspect_port(port) {
            Ok(inspected) => inspected,
            Err(error) => {
                warning.push_str(&format!("\n{error}"));
                platform::Port {
                    occupied: true,
                    listeners: Vec::new(),
                }
            }
        };
        let mut port_status = format!(
            "Port {port}: {}",
            if inspected.occupied { "IN USE" } else { "FREE" }
        );
        if inspected.occupied && inspected.listeners.is_empty() {
            port_status.push_str("\nProcess details unavailable; it cannot be stopped here.");
        }
        for listener in &inspected.listeners {
            port_status.push_str(&format!("\n{}", listener.details));
        }
        let build = if paths.llama.is_empty() && available {
            let mut manifest = bundled_manifest();
            manifest["backend"] = json!("bundled");
            manifest["previous"] = json!("");
            manifest
        } else if !paths.llama.is_empty() {
            external_build(Path::new(&paths.llama)).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        Ok(Configuration {
            llama_dir: paths.llama.clone(),
            models_dir: paths.models.clone(),
            server_available: available && discovery.valid,
            bundled_available: self
                .store
                .environment
                .bundled_server
                .as_ref()
                .is_some_and(|server| executable(server)),
            app_store: cfg!(feature = "app-store"),
            port,
            port_status,
            warning: warning.trim().into(),
            generation_preset: settings.generation_preset(),
            settings,
            models: discovered_models,
            devices: discovery.devices.clone(),
            listeners: inspected.listeners,
            memory: json!({"availableRamMiB": platform::available_memory(), "devices": capabilities::device_memory(&discovery.devices)}),
            build,
            profiles: self.store.profiles()?,
            capabilities: capabilities::summary(&discovery.help, &discovery.devices),
            presets: settings::presets(),
            current_profile: None,
            modified: false,
            restart_required: false,
            saved_settings: None,
        })
    }

    pub fn launch(&self, paths: &Paths, settings: &Settings) -> Result<(PathBuf, Vec<String>)> {
        let model = Path::new(&settings.model)
            .canonicalize()
            .unwrap_or_default();
        if !self.model_access.permits(&model) {
            return Err(
                "Choose the model's folder in Settings to grant access before launching.".into(),
            );
        }
        let server = self.server(paths).filter(|server| executable(server))
            .ok_or(if cfg!(feature = "app-store") {
                "The bundled llama-server is missing. Reinstall Mir.cpp from the App Store."
            } else {
                "llama-server not found. Select an existing build in Folders, or install a Mir.cpp package with its bundled backend."
            })?;
        if !readable_model(&settings.model) {
            return Err(format!(
                "GGUF model missing or unreadable: {}",
                settings.model
            ));
        }
        let discovery = self.discovery.lock().map_err(|error| error.to_string())?;
        if !discovery.valid {
            return Err(discovery.warning.clone());
        }
        let args = capabilities::arguments(
            settings,
            &discovery.help,
            discovery
                .devices_reported
                .then_some(discovery.devices.as_slice()),
            &self.store.environment,
        )?;
        let inspected = platform::inspect_port(
            settings
                .port
                .parse::<u16>()
                .map_err(|error| error.to_string())?,
        )?;
        if inspected.occupied {
            return Err(format!(
                "Port {}: IN USE. Stop its listener or choose another port.",
                settings.port
            ));
        }
        Ok((server, args))
    }

    pub fn browse(&self, location: &str, hidden: bool) -> Result<Value> {
        let home = &self.store.environment.home;
        let location = match location {
            "" | "~" => home.clone(),
            value if value.starts_with("~/") => home.join(&value[2..]),
            value => PathBuf::from(value),
        };
        let location = location
            .canonicalize()
            .map_err(|error| format!("Choose a readable directory: {error}"))?;
        let mut directories = Vec::new();
        for entry in
            fs::read_dir(&location).map_err(|error| format!("Cannot browse directory: {error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.path().is_dir() && (hidden || !name.starts_with('.')) {
                directories.push(json!({"name": name, "path": entry.path()}));
            }
        }
        directories.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        Ok(
            json!({"path": location, "parent": location.parent().unwrap_or(&location), "directories": directories}),
        )
    }
}

pub fn bundled_manifest() -> Value {
    serde_json::from_str(include_str!("../../../packaging/llama-runtime.json"))
        .expect("The checked-in backend manifest must be valid JSON")
}

fn external_build(root: &Path) -> Option<Value> {
    let content = fs::read_to_string(root.join("mir-build.conf")).ok()?;
    let mut fields = serde_json::Map::new();
    for line in content.lines() {
        let (name, value) = line.split_once('=')?;
        if !matches!(name, "format" | "tag" | "commit" | "backend" | "previous")
            || fields.insert(name.into(), json!(value)).is_some()
        {
            return None;
        }
    }
    if fields.get("format")? != "1" {
        return None;
    }
    Some(Value::Object(fields))
}
