use mir_desktop::{
    configuration::{capabilities, environment::Environment, models},
    platform,
    workspace::Settings,
};
use std::{collections::BTreeMap, fs, net::TcpListener};
use std::{
    os::unix::fs::PermissionsExt,
    sync::Arc,
    time::{Duration, Instant},
};

fn isolated_environment(
    root: &std::path::Path,
    bundled: Option<std::path::PathBuf>,
) -> Environment {
    Environment::from_variables(
        BTreeMap::from([
            ("HOME".into(), root.as_os_str().to_owned()),
            ("PATH".into(), std::env::var_os("PATH").unwrap_or_default()),
        ]),
        bundled,
    )
    .unwrap()
}

fn unused_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[test]
fn a_mismatched_bundled_version_is_reported_and_cannot_be_launched() {
    use mir_desktop::configuration::{native::NativeConfiguration, storage::Paths};
    let work = tempfile::tempdir().unwrap();
    let server = work.path().join("mir-llama-server");
    fs::write(&server, include_bytes!("../../tests/fixtures/server.py")).unwrap();
    fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
    let native = NativeConfiguration::new(isolated_environment(work.path(), Some(server))).unwrap();
    let model = work.path().join("model.gguf");
    fs::write(&model, []).unwrap();
    let settings = Settings {
        model: model.to_str().unwrap().into(),
        port: unused_port().to_string(),
        ..Settings::default()
    };
    let config = native
        .snapshot(&Paths::default(), settings.clone())
        .unwrap();
    assert!(!config.server_available);
    assert!(config.warning.contains("pinned source commit"));
    assert!(native
        .launch(&Paths::default(), &settings)
        .unwrap_err()
        .contains("pinned source commit"));
}

#[test]
fn shutdown_cancels_and_reaps_a_stalled_discovery_process() {
    use mir_desktop::configuration::{native::NativeConfiguration, storage::Paths};
    let work = tempfile::tempdir().unwrap();
    let bin = work.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let server = bin.join("llama-server");
    fs::write(&server, b"#!/usr/bin/env python3\nimport os,time\nfrom pathlib import Path\nPath(__file__).with_name('pid').write_text(str(os.getpid()))\nwhile True: time.sleep(0.01)\n").unwrap();
    fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
    let native =
        Arc::new(NativeConfiguration::new(isolated_environment(work.path(), None)).unwrap());
    let service = native.clone();
    let paths = Paths {
        llama: work.path().to_str().unwrap().into(),
        ..Paths::default()
    };
    let worker = std::thread::spawn(move || {
        service.snapshot(
            &paths,
            Settings {
                port: unused_port().to_string(),
                ..Settings::default()
            },
        )
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    while !bin.join("pid").exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    native.cancel_discovery().unwrap();
    assert!(worker.join().unwrap().is_err());
    let pid: i32 = fs::read_to_string(bin.join("pid"))
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn help_parsing_keeps_wrapped_kv_lists_separate_and_validates_selected_capabilities() {
    let help = "--model FNAME\n--port PORT\n--cache-type-k TYPE allowed values: f16, q8_0,\n q4_0\n--cache-type-k-draft TYPE allowed values: unexpected\n--cache-type-v TYPE allowed values: f16, q8_0\n--split-mode {none,layer,row,tensor}\n--device DEV\n--gpu-layers N\n--ctx-size N\n";
    assert_eq!(
        capabilities::cache_types(help, "--cache-type-k"),
        ["f16", "q8_0", "q4_0"]
    );
    assert_eq!(
        capabilities::cache_types(help, "--cache-type-v"),
        ["f16", "q8_0"]
    );
    assert_eq!(
        capabilities::split_modes(help),
        ["none", "layer", "row", "tensor"]
    );
    assert!(!capabilities::supports(help, "--cache-type-k-draft-other"));
    let devices = capabilities::devices("Available devices:\n  Future.0: Accelerator (8192 MiB, 4096 MiB free)\n  CPU0: Native CPU\n");
    assert_eq!(devices.len(), 2);
    assert_eq!(
        capabilities::device_memory(&devices)[0]["availableMiB"],
        4096
    );
    let work = tempfile::tempdir().unwrap();
    let environment = Environment::from_variables(
        BTreeMap::from([("HOME".into(), work.path().as_os_str().to_owned())]),
        None,
    )
    .unwrap();
    let mut settings = Settings {
        device: "none".into(),
        cache_type_v: "f16".into(),
        split_mode: "row".into(),
        gpu_layers: "all".into(),
        ..Settings::default()
    };
    let arguments = capabilities::arguments(&settings, help, Some(&devices), &environment).unwrap();
    assert!(!arguments
        .iter()
        .any(|value| matches!(value.as_str(), "--ctx-size" | "--split-mode")));
    assert!(arguments
        .windows(2)
        .any(|pair| pair == ["--gpu-layers", "0"]));
    assert_eq!(&arguments[arguments.len() - 2..], ["--host", "127.0.0.1"]);
    settings.device = "Missing0".into();
    assert!(
        capabilities::arguments(&settings, help, Some(&devices), &environment)
            .unwrap_err()
            .contains("unavailable")
    );
    settings.device = "auto".into();
    settings.cache_type_v = "q4_0".into();
    assert!(
        capabilities::arguments(&settings, help, Some(&devices), &environment)
            .unwrap_err()
            .contains("not advertised")
    );
}

fn gguf(kind: &str, split: u16, big_endian: bool) -> Vec<u8> {
    let mut data = b"GGUF".to_vec();
    let number = |value: u64, length: usize, data: &mut Vec<u8>| {
        if big_endian {
            data.extend_from_slice(&value.to_be_bytes()[8 - length..]);
        } else {
            data.extend_from_slice(&value.to_le_bytes()[..length]);
        }
    };
    number(3, 4, &mut data);
    number(0, 8, &mut data);
    number(2, 8, &mut data);
    for (key, value_type, value) in [
        ("general.type", 8, kind.as_bytes()),
        ("split.no", 2, &split.to_le_bytes()[..]),
    ] {
        number(key.len() as u64, 8, &mut data);
        data.extend_from_slice(key.as_bytes());
        number(value_type, 4, &mut data);
        if value_type == 8 {
            number(value.len() as u64, 8, &mut data);
            data.extend_from_slice(value);
        } else {
            number(u64::from(split), 2, &mut data);
        }
    }
    data
}

#[test]
fn model_discovery_uses_metadata_recurses_and_preserves_unknown_files() {
    let work = tempfile::tempdir().unwrap();
    let root = work.path();
    fs::create_dir(root.join(".hidden")).unwrap();
    fs::write(
        root.join("misleading-mmproj-name.gguf"),
        gguf("model", 0, false),
    )
    .unwrap();
    fs::write(root.join("component.gguf"), gguf("mmproj", 0, false)).unwrap();
    fs::write(root.join("continuation.gguf"), gguf("model", 1, false)).unwrap();
    fs::write(root.join(".hidden/model.GGUF"), gguf("model", 0, true)).unwrap();
    fs::write(root.join("unknown.gguf"), b"Unknown metadata").unwrap();
    fs::write(root.join("._resource.gguf"), []).unwrap();
    std::os::unix::fs::symlink(root, root.join("directory-cycle")).unwrap();
    let models = models::discover(root).unwrap();
    assert_eq!(
        models
            .iter()
            .map(|model| model.label.as_str())
            .collect::<Vec<_>>(),
        [
            ".hidden/model.GGUF",
            "misleading-mmproj-name.gguf",
            "unknown.gguf"
        ]
    );
    let empty = root.join("empty");
    fs::create_dir(&empty).unwrap();
    assert!(models::discover(&empty).unwrap().is_empty());
}

#[test]
fn native_port_inspection_blocks_busy_ports_and_identifies_owned_sockets() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let inspected = platform::inspect_port(port).unwrap();
    assert!(inspected.occupied);
    let process = inspected
        .listeners
        .iter()
        .find(|owner| owner.pid == std::process::id())
        .expect("Native services must identify this process's own listener");
    assert!(!process.identity.is_empty());
    let identity = platform::identity(process.pid).unwrap();
    assert_eq!(identity.identity, process.identity);
    drop(listener);
    assert!(!platform::inspect_port(port).unwrap().occupied);
}
