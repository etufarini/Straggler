#![cfg(not(feature = "app-store"))]

use mir_desktop::configuration::{environment::Environment, native::NativeConfiguration};
use std::{
    collections::BTreeMap, ffi::OsString, fs, net::TcpListener, os::unix::fs::PermissionsExt,
};

#[test]
fn packaged_direct_start_keeps_defaults_environment_literal_arguments_and_exit_status() {
    let work = tempfile::tempdir().unwrap();
    let backend = work.path().join("llama.cpp");
    fs::create_dir_all(backend.join("bin")).unwrap();
    let server = backend.join("bin/llama-server");
    fs::write(
        &server,
        r#"#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
if sys.argv[1:] == ['--help']:
    print('--model --port --cache-type-k --cache-type-v')
elif sys.argv[1:] == ['--list-devices']:
    print('Available devices:')
else:
    Path(os.environ['TEST_ARGUMENTS']).write_text(json.dumps(sys.argv[1:]))
    sys.exit(17)
"#,
    )
    .unwrap();
    fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
    let model = work.path().join("model with spaces.gguf");
    fs::write(&model, []).unwrap();
    let model = model.canonicalize().unwrap();
    let arguments_file = work.path().join("arguments.json");
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let environment = Environment::from_variables(
        BTreeMap::from([
            (OsString::from("HOME"), work.path().as_os_str().to_owned()),
            ("PATH".into(), std::env::var_os("PATH").unwrap_or_default()),
            ("MIR_LLAMA_CPP_DIR".into(), backend.into_os_string()),
            ("MIR_PORT".into(), port.to_string().into()),
            ("LLAMA_HOST".into(), "0.0.0.0".into()),
            ("MIR_HOST".into(), "127.0.0.1".into()),
            (
                "TEST_ARGUMENTS".into(),
                arguments_file.clone().into_os_string(),
            ),
        ]),
        None,
    )
    .unwrap();
    let native = NativeConfiguration::new(environment).unwrap();
    let trailing: Vec<OsString> = [
        "--alias",
        "$(touch unsafe); quoted ' value",
        "--port=12456",
        "--cache-type-k",
        "f16",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    let result = native
        .direct_command(&model, &trailing)
        .unwrap()
        .status()
        .unwrap();
    assert_eq!(result.code(), Some(17));
    let actual: Vec<String> = serde_json::from_slice(&fs::read(arguments_file).unwrap()).unwrap();
    assert_eq!(&actual[..2], ["--model", model.to_str().unwrap()]);
    assert!(actual
        .windows(2)
        .any(|pair| pair == ["--cache-type-k", "q4_0"]));
    assert!(actual
        .windows(2)
        .any(|pair| pair == ["--host", "127.0.0.1"]));
    assert_eq!(
        actual[actual.len() - trailing.len()..],
        trailing
            .iter()
            .map(|s| s.to_str().unwrap())
            .collect::<Vec<_>>()
    );
    assert!(!work.path().join("unsafe").exists());
    assert!(native
        .direct_command(&work.path().join("missing.gguf"), &[])
        .unwrap_err()
        .contains("GGUF model missing"));
}
