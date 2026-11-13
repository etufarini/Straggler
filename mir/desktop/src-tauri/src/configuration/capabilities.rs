use super::{
    environment::Environment,
    settings::{cache_type, token},
};
use crate::{
    workspace::{Device, Settings},
    Result,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    io::{Read, Seek, SeekFrom},
    os::unix::process::CommandExt,
    path::Path,
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

pub fn probe(
    environment: &Environment,
    server: &Path,
    flag: &str,
    cancelled: &AtomicBool,
) -> Result<String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("Backend discovery cancelled.".into());
    }
    let mut log = tempfile::tempfile().map_err(|error| error.to_string())?;
    let mut child = environment
        .command(server)
        .arg(flag)
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|error| error.to_string())?)
        .stderr(log.try_clone().map_err(|error| error.to_string())?)
        .process_group(0)
        .spawn()
        .map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(15);
    let exit = loop {
        if let Some(exit) = child.try_wait().map_err(|error| error.to_string())? {
            break exit;
        }
        if Instant::now() >= deadline || cancelled.load(Ordering::Relaxed) {
            // Like the previous bounded probes, timeout cleanup affects only this
            // still-owned discovery child, never the supervised server or a listener.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGTERM);
            }
            let grace = Instant::now() + Duration::from_secs(1);
            while child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
            {
                if Instant::now() >= grace {
                    child.kill().map_err(|error| error.to_string())?;
                    child.wait().map_err(|error| error.to_string())?;
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
            return Err(format!(
                "llama-server {flag} discovery was cancelled or timed out."
            ));
        }
        thread::sleep(Duration::from_millis(10));
    };
    log.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    log.take(2 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let output = String::from_utf8_lossy(&bytes).into_owned();
    if !exit.success() {
        return Err(format!("llama-server {flag} failed ({exit}): {output}"));
    }
    Ok(output)
}

pub fn supports(help: &str, flag: &str) -> bool {
    help.split(|character: char| character.is_whitespace() || matches!(character, ',' | '='))
        .any(|word| word == flag)
}

pub fn cache_types(help: &str, flag: &str) -> Vec<String> {
    let mut active = false;
    let mut values = false;
    let mut result = Vec::new();
    for line in help.lines() {
        if line.trim_start().starts_with('-') {
            if supports(line, flag) {
                active = true;
            } else if active {
                break;
            }
        }
        if !active {
            continue;
        }
        let words = if let Some((_, words)) = line.split_once("allowed values:") {
            values = true;
            words
        } else if values {
            line
        } else {
            continue;
        };
        for word in words
            .split(|character: char| character.is_whitespace() || character == ',')
            .filter(|word| !word.is_empty())
        {
            if !cache_type(word) {
                return result;
            }
            result.push(word.into());
        }
    }
    result
}

pub fn split_modes(help: &str) -> Vec<String> {
    help.lines()
        .find(|line| supports(line, "--split-mode"))
        .and_then(|line| line.split_once('{'))
        .and_then(|(_, rest)| rest.split_once('}'))
        .map(|(values, _)| {
            values
                .split(',')
                .filter(|value| token(value, "_-", 32) && value.as_bytes()[0].is_ascii_lowercase())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub fn devices(output: &str) -> Vec<Device> {
    let mut result = Vec::new();
    for line in output
        .lines()
        .filter(|line| line.starts_with(char::is_whitespace))
    {
        if let Some((name, label)) = line.trim().split_once(": ") {
            if token(name, "_.:-", usize::MAX) && !label.trim().is_empty() {
                result.push(Device {
                    name: name.into(),
                    label: label.trim().into(),
                });
            }
        }
    }
    result
}

pub fn device_memory(devices: &[Device]) -> Vec<Value> {
    devices
        .iter()
        .filter_map(|device| {
            let (_, suffix) = device.label.rsplit_once('(')?;
            let (total, free) = suffix.strip_suffix(" MiB free)")?.split_once(" MiB, ")?;
            let total: u64 = total.parse().ok()?;
            let free: u64 = free.parse().ok()?;
            (total > 0 && free <= total).then(|| json!({"name": device.name, "availableMiB": free}))
        })
        .collect()
}

pub fn summary(help: &str, devices: &[Device]) -> Value {
    json!({
        "cacheTypesK": cache_types(help, "--cache-type-k"), "cacheTypesV": cache_types(help, "--cache-type-v"),
        "splitModes": split_modes(help), "multipleDevices": devices.iter().map(|device| &device.name).collect::<BTreeSet<_>>().len() >= 2,
        "buildNote": "Available features are advertised by the selected llama-server.",
    })
}

pub fn arguments(
    settings: &Settings,
    help: &str,
    devices: Option<&[Device]>,
    environment: &Environment,
) -> Result<Vec<String>> {
    let mut pairs: Vec<(String, String)> = vec![
        ("model".into(), settings.model.clone()),
        ("port".into(), settings.port.clone()),
    ];
    let fields = settings.fields();
    for (field, flag) in [
        ("cache_type_k", "cache-type-k"),
        ("cache_type_v", "cache-type-v"),
        ("context", "ctx-size"),
        ("threads", "threads"),
        ("device", "device"),
        ("temperature", "temperature"),
        ("top_p", "top-p"),
        ("top_k", "top-k"),
        ("min_p", "min-p"),
        ("repeat_penalty", "repeat-penalty"),
        ("presence_penalty", "presence-penalty"),
        ("frequency_penalty", "frequency-penalty"),
        ("seed", "seed"),
        ("max_tokens", "n-predict"),
    ] {
        if fields[field] != "auto" {
            pairs.push((flag.into(), fields[field].clone()));
        }
    }
    if settings.device == "none" {
        pairs.push(("gpu-layers".into(), "0".into()));
    } else {
        for (field, flag) in [
            ("gpu_layers", "gpu-layers"),
            ("split_mode", "split-mode"),
            ("tensor_split", "tensor-split"),
            ("fit_target", "fit-target"),
        ] {
            if fields[field] != "auto" {
                pairs.push((flag.into(), fields[field].clone()));
            }
        }
    }
    match settings.prompt_processing.as_str() {
        "low-memory" => {
            pairs.push(("batch-size".into(), "512".into()));
            pairs.push(("ubatch-size".into(), "128".into()));
        }
        "large-batch" => {
            pairs.push(("batch-size".into(), "2048".into()));
            pairs.push(("ubatch-size".into(), "1024".into()));
        }
        _ => {}
    }
    if !help.is_empty() {
        for (flag, _) in &pairs {
            if !supports(help, &format!("--{flag}")) {
                return Err(format!("This llama-server does not advertise --{flag}. Use Auto/Default for that setting or select a supported build."));
            }
        }
    }
    for (flag, value) in [
        ("--cache-type-k", &settings.cache_type_k),
        ("--cache-type-v", &settings.cache_type_v),
    ] {
        let types = cache_types(help, flag);
        if value != "auto" && !types.is_empty() && !types.contains(value) {
            return Err(format!(
                "KV cache type '{value}' is not advertised by this llama-server."
            ));
        }
    }
    let selected_device = if settings.device == "auto" {
        environment
            .value("LLAMA_ARG_DEVICE")
            .unwrap_or("auto".into())
    } else {
        settings.device.clone()
    };
    if !matches!(selected_device.as_str(), "auto" | "none") {
        if let Some(devices) = devices {
            for name in selected_device.split(',') {
                if !devices.iter().any(|device| device.name == name) {
                    return Err(format!(
                        "Device '{name}' is unavailable in this llama.cpp build."
                    ));
                }
            }
        }
    }
    let modes = split_modes(help);
    let split = if settings.split_mode == "auto" {
        environment
            .value("LLAMA_ARG_SPLIT_MODE")
            .unwrap_or("auto".into())
    } else {
        settings.split_mode.clone()
    };
    if selected_device != "none" && split != "auto" && !modes.is_empty() && !modes.contains(&split)
    {
        return Err(format!(
            "GPU split mode '{split}' is not advertised by this llama-server."
        ));
    }
    let mut arguments: Vec<String> = pairs
        .into_iter()
        .flat_map(|(flag, value)| [format!("--{flag}"), value])
        .collect();
    arguments.extend(["--host".into(), "127.0.0.1".into()]);
    Ok(arguments)
}
