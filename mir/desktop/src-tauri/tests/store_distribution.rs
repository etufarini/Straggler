#![cfg(all(feature = "app-store", target_os = "macos"))]

use mir_desktop::{configuration::environment::Environment, model_access::ModelAccess, Runtime};
use std::{collections::BTreeMap, ffi::OsString, fs};

#[test]
fn store_rejects_external_code_and_paths_without_native_picker_grants() {
    let work = tempfile::tempdir().unwrap();
    let models = work.path().join("models");
    fs::create_dir(&models).unwrap();
    let environment = Environment::from_variables(
        BTreeMap::from([
            (OsString::from("HOME"), work.path().as_os_str().to_owned()),
            ("MIR_LLAMA_CPP_DIR".into(), "/external/backend".into()),
        ]),
        None,
    )
    .unwrap();
    let runtime = Runtime::new(environment, work.path().join("data")).unwrap();
    let configuration = runtime.inspect().unwrap();
    assert!(configuration.app_store);
    assert!(configuration.llama_dir.is_empty());
    assert!(configuration.warning.contains("included backend"));
    let native = mir_desktop::configuration::native::NativeConfiguration::new(
        Environment::from_variables(
            BTreeMap::from([("HOME".into(), work.path().as_os_str().to_owned())]),
            None,
        )
        .unwrap(),
    )
    .unwrap();
    assert!(native
        .direct_command(&models.join("model.gguf"), &[])
        .unwrap_err()
        .contains("native picker"));
    let error = runtime
        .workspace_action("set-path", vec!["llama".into(), "/external".into()], vec![])
        .unwrap_err();
    assert!(error.contains("included backend"));
    let error = runtime
        .workspace_action(
            "set-path",
            vec!["models".into(), models.to_string_lossy().into()],
            vec![],
        )
        .unwrap_err();
    assert!(error.contains("native picker"));
}

#[test]
fn corrupt_or_expired_permissions_report_recovery_without_destroying_the_record() {
    let work = tempfile::tempdir().unwrap();
    fs::create_dir(work.path().join("desktop")).unwrap();
    let record = work.path().join("desktop/model-folders.json");
    for bytes in [b"bad json".as_slice(), br#"{"/missing":[1,2,3]}"#] {
        fs::write(&record, bytes).unwrap();
        let permissions = ModelAccess::restore(work.path());
        assert!(!permissions.permits(work.path()));
        assert!(permissions.warning().contains("again"));
        assert_eq!(fs::read(&record).unwrap(), bytes);
    }
}
