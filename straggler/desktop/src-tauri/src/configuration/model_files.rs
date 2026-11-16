use crate::Result;
use serde::Deserialize;
use std::{fs::File, io::Read, path::Path};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelFileKind {
    Template,
    Mtp,
}

impl ModelFileKind {
    pub fn title(self) -> &'static str {
        match self {
            Self::Template => "Choose chat template",
            Self::Mtp => "Choose MTP file",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Template => "jinja",
            Self::Mtp => "gguf",
        }
    }

    pub fn validate(self, path: &Path) -> Result<()> {
        match self {
            Self::Template => super::templates::validate(path),
            Self::Mtp => validate_mtp(path),
        }
    }
}

pub fn readable(path: &Path, label: &str) -> Result<File> {
    if !path.is_absolute() || !path.to_str().is_some_and(super::settings::literal) {
        return Err(format!(
            "{label} requires an absolute UTF-8 path without line breaks."
        ));
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("Cannot read {label} {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "{label} must be a readable file: {}",
            path.display()
        ));
    }
    File::open(path).map_err(|error| format!("Cannot read {label} {}: {error}", path.display()))
}

pub fn validate_mtp(path: &Path) -> Result<()> {
    let mut file = readable(path, "MTP file")?;
    let mut magic = [0; 4];
    if file.read_exact(&mut magic).is_err() || magic != *b"GGUF" {
        return Err(format!("MTP file must be a GGUF file: {}", path.display()));
    }
    // llama.cpp owns architecture and target-model compatibility checks.
    Ok(())
}
