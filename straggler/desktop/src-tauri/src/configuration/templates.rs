use super::{capabilities::supports, environment::Environment};
use crate::Result;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

pub fn launch_file(model: &Path, help: &str, environment: &Environment) -> Result<Option<PathBuf>> {
    // Native overrides retain precedence, including explicitly empty values.
    if environment.value("LLAMA_ARG_CHAT_TEMPLATE").is_some()
        || environment.value("LLAMA_ARG_CHAT_TEMPLATE_FILE").is_some()
    {
        return Ok(None);
    }
    let Some(directory) = model.parent() else {
        return Ok(None);
    };
    let path = directory.join("chat_template.jinja");
    match path.symlink_metadata() {
        Ok(_) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Cannot inspect chat template {}: {error}",
                path.display()
            ))
        }
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("Cannot read chat template {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "Chat template must be a readable UTF-8 file: {}",
            path.display()
        ));
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read chat template {}: {error}", path.display()))?;
    if content.trim().is_empty() || content.contains('\0') {
        return Err(format!(
            "Chat template must contain nonempty text without NUL characters: {}",
            path.display()
        ));
    }
    for flag in ["--jinja", "--chat-template-file"] {
        if !supports(help, flag) {
            return Err(format!("This llama-server does not advertise {flag}, required for {}. Select a supported build or remove the separate template to use the GGUF template.", path.display()));
        }
    }
    Ok(Some(path))
}
