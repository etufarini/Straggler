use super::{capabilities::supports, environment::Environment, model_files};
use crate::Result;
use std::{
    io::Read,
    path::{Path, PathBuf},
};

const MAX_TEMPLATE_BYTES: u64 = 2 * 1024 * 1024;

pub fn native_override(environment: &Environment) -> String {
    ["LLAMA_ARG_CHAT_TEMPLATE", "LLAMA_ARG_CHAT_TEMPLATE_FILE"]
        .into_iter()
        .filter(|name| environment.value(name).is_some())
        .collect::<Vec<_>>()
        .join(", ")
}

pub fn candidate(model: &Path) -> Option<String> {
    let path = model.parent()?.join("chat_template.jinja");
    if !path.is_file() {
        return None;
    }
    path.to_str().map(str::to_owned)
}

pub fn validate(path: &Path) -> Result<()> {
    let file = model_files::readable(path, "Chat template")?;
    let mut content = String::new();
    file.take(MAX_TEMPLATE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| format!("Cannot read chat template {}: {error}", path.display()))?;
    if content.len() as u64 > MAX_TEMPLATE_BYTES {
        return Err("Chat template exceeds the 2 MiB limit.".into());
    }
    if content.trim().is_empty() || content.contains('\0') {
        return Err(format!(
            "Chat template must contain nonempty UTF-8 text without NUL characters: {}",
            path.display()
        ));
    }
    Ok(())
}

pub fn launch_file(
    selected: &str,
    help: &str,
    environment: &Environment,
) -> Result<Option<PathBuf>> {
    // Native overrides retain precedence, including explicitly empty values.
    if selected.is_empty() || !native_override(environment).is_empty() {
        return Ok(None);
    }
    let path = Path::new(selected);
    validate(path)?;
    for flag in ["--jinja", "--chat-template-file"] {
        if !supports(help, flag) {
            return Err(format!("This llama-server does not advertise {flag}, required for {}. Select a supported build or choose the default chat template.", path.display()));
        }
    }
    Ok(Some(path.to_owned()))
}
