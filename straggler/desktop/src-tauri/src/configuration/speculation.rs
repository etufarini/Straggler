use super::{capabilities::supports, environment::Environment, model_files};
use crate::{workspace::Settings, Result};
use std::path::Path;

pub fn native_override(environment: &Environment) -> String {
    [
        "LLAMA_ARG_SPEC_TYPE",
        "LLAMA_ARG_SPEC_DRAFT_MODEL",
        "LLAMA_ARG_MODEL_DRAFT",
        "LLAMA_ARG_SPEC_DRAFT_HF_REPO",
        "LLAMA_ARG_HF_REPO_DRAFT",
    ]
    .into_iter()
    .filter(|name| environment.value(name).is_some())
    .collect::<Vec<_>>()
    .join(", ")
}

pub fn supported(help: &str) -> bool {
    let mut active = false;
    for line in help.lines() {
        if line.trim_start().starts_with('-') {
            if supports(line, "--spec-type") {
                active = true;
            } else if active {
                break;
            }
        }
        if active
            && line
                .split(|character: char| character.is_whitespace() || "[]{}|,".contains(character))
                .any(|word| word == "draft-mtp")
        {
            return true;
        }
    }
    false
}

pub fn file_flag(help: &str) -> Option<&'static str> {
    ["--spec-draft-model", "--model-draft"]
        .into_iter()
        .find(|flag| supports(help, flag))
}

pub fn arguments(
    settings: &Settings,
    help: &str,
    environment: &Environment,
) -> Result<Vec<String>> {
    if !native_override(environment).is_empty() {
        return Ok(Vec::new());
    }
    if settings.mtp == "off" {
        return Ok(if supports(help, "--spec-type") {
            vec!["--spec-type".into(), "none".into()]
        } else {
            Vec::new()
        });
    }
    if !supported(help) {
        return Err("This llama-server does not advertise draft-mtp. Turn MTP off or select a supported build.".into());
    }
    let mut arguments = vec!["--spec-type".into(), "draft-mtp".into()];
    if settings.mtp == "file" {
        if settings.mtp_file.is_empty() {
            return Err("Choose a compatible external MTP GGUF file before launching.".into());
        }
        let flag = file_flag(help)
            .ok_or("This llama-server does not advertise an external draft-model option.")?;
        model_files::validate_mtp(Path::new(&settings.mtp_file))?;
        arguments.extend([flag.into(), settings.mtp_file.clone()]);
    }
    Ok(arguments)
}
