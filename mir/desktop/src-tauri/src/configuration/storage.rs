use super::{
    environment::Environment,
    settings::{literal, token},
};
use crate::{files::write_atomic, platform, workspace::Settings, Result};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Default)]
pub struct Paths {
    pub llama: String,
    pub models: String,
    pub warning: String,
}

pub struct Store {
    pub environment: Environment,
}

fn copy_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            std::os::unix::fs::symlink(fs::read_link(entry.path())?, target)?;
        } else if kind.is_dir() {
            fs::create_dir(&target)?;
            copy_directory(&entry.path(), &target)?;
            fs::set_permissions(target, entry.metadata()?.permissions())?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Unsupported legacy configuration entry",
            ));
        }
    }
    Ok(())
}

fn record(path: &Path) -> Result<BTreeMap<String, String>> {
    let data = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let mut fields = BTreeMap::new();
    for line in data.lines() {
        let (name, value) = line.split_once('=').ok_or("Invalid saved path line.")?;
        if !matches!(name, "llama_dir" | "models_dir")
            || !literal(value)
            || fields.insert(name.into(), value.into()).is_some()
        {
            return Err("Invalid saved paths.".into());
        }
    }
    if fields.len() != 2 {
        return Err("Saved paths are incomplete.".into());
    }
    Ok(fields)
}

pub fn profile_name(name: &str) -> bool {
    name.as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        && token(name, " ._-", 80)
}

pub fn server_path(folder: &str) -> PathBuf {
    ["build/bin/llama-server", "bin/llama-server"]
        .into_iter()
        .map(|name| Path::new(folder).join(name))
        .find(|path| executable(path))
        .unwrap_or_else(|| Path::new(folder).join("build/bin/llama-server"))
}

pub fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

pub fn readable_model(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".gguf")
        && fs::File::open(path)
            .and_then(|file| file.metadata())
            .is_ok_and(|metadata| metadata.is_file())
}

impl Store {
    pub fn new(environment: Environment) -> Result<Self> {
        let store = Self { environment };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let destination = &self.environment.config;
        if destination.symlink_metadata().is_ok() {
            return Ok(());
        }
        let parent = destination
            .parent()
            .ok_or("The configuration folder has no parent.")?;
        let legacy = parent.join("llama-launcher");
        if !legacy.is_dir() {
            return Ok(());
        }
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = tempfile::Builder::new()
            .prefix(".mir-migration.")
            .tempdir_in(parent)
            .map_err(|error| error.to_string())?;
        copy_directory(&legacy, temporary.path()).map_err(|error| {
            format!(
                "Cannot import previous launcher settings. Original settings were kept: {error}"
            )
        })?;
        match platform::rename_directory_exclusive(temporary.path(), destination) {
            Ok(()) => {
                let _ = temporary.keep();
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
            Err(error) => Err(format!(
                "Cannot activate imported settings. Original settings were kept: {error}"
            )),
        }
    }

    pub fn paths(&self) -> Paths {
        let file = self.environment.config.join("paths.conf");
        let mut paths = Paths::default();
        if file.exists() {
            match record(&file) {
                Ok(fields) => {
                    paths.llama = fields["llama_dir"].clone();
                    paths.models = fields["models_dir"].clone();
                }
                Err(_) => {
                    paths.warning =
                        "Saved paths could not be read. Set them again in Folders.".into()
                }
            }
        }
        let environment = &self.environment;
        paths.llama = environment.control(
            "LLAMA_CPP_DIR",
            environment
                .value("LLAMA_CPP_DIR")
                .filter(|value| !value.is_empty())
                .unwrap_or(paths.llama),
        );
        paths.models = environment.control(
            "MODELS_DIR",
            environment
                .value("LLAMA_MODELS_DIR")
                .filter(|value| !value.is_empty())
                .unwrap_or(paths.models),
        );
        if cfg!(feature = "app-store") && !paths.llama.is_empty() {
            paths.llama.clear();
            paths
                .warning
                .push_str("The App Store edition uses only its included backend.\n");
        }
        paths
    }

    pub fn save_paths(&self, paths: &Paths) -> Result<()> {
        if !literal(&paths.llama) || !literal(&paths.models) {
            return Err("Folder paths must not contain line breaks or NUL characters.".into());
        }
        fs::create_dir_all(&self.environment.config)
            .map_err(|error| format!("Cannot save paths: {error}"))?;
        write_atomic(
            &self.environment.config.join("paths.conf"),
            format!("llama_dir={}\nmodels_dir={}\n", paths.llama, paths.models).as_bytes(),
        )
    }

    pub fn profiles(&self) -> Result<Vec<String>> {
        let directory = self.environment.config.join("profiles");
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("Cannot list saved configurations: {error}")),
        };
        let mut names = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry.path().is_file() {
                continue;
            }
            if let Some(name) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".conf"))
            {
                if profile_name(name) {
                    names.push(name.into());
                }
            }
        }
        names.sort();
        Ok(names)
    }

    fn profile_path(&self, name: &str) -> Result<PathBuf> {
        if !profile_name(name) {
            return Err("Invalid configuration name.".into());
        }
        Ok(self
            .environment
            .config
            .join("profiles")
            .join(format!("{name}.conf")))
    }

    pub fn load_profile(&self, name: &str) -> Result<Settings> {
        let data = fs::read_to_string(self.profile_path(name)?)
            .map_err(|error| format!("Cannot load configuration: {error}"))?;
        let settings = Settings::from_profile(&data)?;
        if !readable_model(&settings.model) {
            return Err("Cannot load configuration: invalid settings or missing model. Current settings were kept.".into());
        }
        Ok(settings)
    }

    pub fn save_profile(&self, name: &str, settings: &Settings, replace: bool) -> Result<()> {
        let path = self.profile_path(name)?;
        let settings = settings.clone().validated()?;
        if !readable_model(&settings.model) {
            return Err("Select a readable GGUF model before saving.".into());
        }
        if path.symlink_metadata().is_ok() && !replace {
            return Err("Confirm replacement of this configuration.".into());
        }
        fs::create_dir_all(path.parent().expect("Profiles have a parent"))
            .map_err(|error| format!("Cannot save configuration: {error}"))?;
        write_atomic(&path, settings.profile_data()?.as_bytes())
    }

    pub fn delete_profile(&self, name: &str, confirmed: bool) -> Result<()> {
        let path = self.profile_path(name)?;
        if !confirmed {
            return Err("Confirm deletion.".into());
        }
        fs::remove_file(path).map_err(|error| format!("Cannot delete configuration: {error}"))
    }
}
