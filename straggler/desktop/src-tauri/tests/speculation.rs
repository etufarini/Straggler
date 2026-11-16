use std::{collections::BTreeMap, fs};
use straggler_desktop::{
    configuration::{environment::Environment, model_files::ModelFileKind, speculation},
    Settings,
};

const HELP: &str = "--spec-type [none|draft-simple|draft-mtp]\n--spec-draft-model FNAME";

#[test]
fn mtp_modes_select_no_draft_embedded_heads_or_an_explicit_gguf() {
    let work = tempfile::tempdir().unwrap();
    let environment = Environment::from_variables(
        BTreeMap::from([("HOME".into(), work.path().as_os_str().to_owned())]),
        None,
    )
    .unwrap();
    let mut settings = Settings::default();
    assert_eq!(
        speculation::arguments(&settings, "", &environment).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        speculation::arguments(&settings, HELP, &environment).unwrap(),
        ["--spec-type", "none"]
    );
    settings.mtp = "model".into();
    assert_eq!(
        speculation::arguments(&settings, HELP, &environment).unwrap(),
        ["--spec-type", "draft-mtp"]
    );
    settings.mtp = "file".into();
    assert!(speculation::arguments(&settings, HELP, &environment).is_err());
    let path = work.path().join("custom ' $(touch unsafe).gguf");
    fs::write(&path, b"GGUFfake").unwrap();
    settings.mtp_file = path.to_str().unwrap().into();
    assert_eq!(
        speculation::arguments(&settings, HELP, &environment).unwrap(),
        vec![
            "--spec-type",
            "draft-mtp",
            "--spec-draft-model",
            path.to_str().unwrap()
        ]
    );
    let legacy = HELP.replace("--spec-draft-model", "--model-draft");
    assert_eq!(
        speculation::arguments(&settings, &legacy, &environment).unwrap()[2],
        "--model-draft"
    );
    fs::write(&path, b"not a GGUF").unwrap();
    assert!(ModelFileKind::Mtp
        .validate(&path)
        .unwrap_err()
        .contains("GGUF"));
    fs::remove_file(&path).unwrap();
    assert!(speculation::arguments(&settings, HELP, &environment).is_err());
    assert!(!work.path().join("unsafe").exists());
}

#[test]
fn mtp_support_comes_from_the_spec_type_option_not_other_help_text() {
    assert!(speculation::supported(HELP));
    assert!(speculation::supported(
        "--spec-type [none|draft-simple|\n draft-mtp]"
    ));
    for help in [
        "--spec-type [none|draft-mtp-other]",
        "--other draft-mtp",
        "--spec-type none\n--other draft-mtp",
        "--spec-type-other draft-mtp",
    ] {
        assert!(!speculation::supported(help), "{help}");
    }
    let work = tempfile::tempdir().unwrap();
    let mut environment = Environment::from_variables(
        BTreeMap::from([("HOME".into(), work.path().as_os_str().to_owned())]),
        None,
    )
    .unwrap();
    let settings = Settings {
        mtp: "file".into(),
        mtp_file: "/missing.gguf".into(),
        ..Settings::default()
    };
    assert!(speculation::arguments(&settings, "--spec-type none", &environment).is_err());
    for name in [
        "LLAMA_ARG_SPEC_TYPE",
        "LLAMA_ARG_SPEC_DRAFT_MODEL",
        "LLAMA_ARG_MODEL_DRAFT",
    ] {
        for value in ["", "external"] {
            environment.variables.insert(name.into(), value.into());
            assert_eq!(speculation::native_override(&environment), name);
            assert!(speculation::arguments(&settings, "", &environment)
                .unwrap()
                .is_empty());
            assert_eq!(environment.value(name).as_deref(), Some(value));
            environment.variables.remove(std::ffi::OsStr::new(name));
        }
    }
}

#[test]
fn profiles_preserve_options_and_model_changes_reset_only_model_specific_fields() {
    let settings = Settings {
        model: "/main.gguf".into(),
        chat_template_file: "/custom.jinja".into(),
        mtp: "file".into(),
        mtp_file: "/mtp.gguf".into(),
        context: "8192".into(),
        ..Settings::default()
    };
    let mut loaded = Settings::from_profile(&settings.profile_data().unwrap()).unwrap();
    assert_eq!(loaded, settings);
    loaded.select_model("/main.gguf".into());
    assert_eq!(loaded, settings);
    loaded.select_model("/other.gguf".into());
    let expected = Settings {
        model: "/other.gguf".into(),
        context: "8192".into(),
        ..Settings::default()
    };
    assert_eq!(loaded, expected);
    for data in [
        "model=/main.gguf\nmtp=unknown",
        "model=/main.gguf\nchat_template_file=relative.jinja",
        "model=/main.gguf\nmtp_file=relative.gguf",
    ] {
        assert!(Settings::from_profile(data).is_err());
    }
}

#[test]
fn model_option_environment_controls_preserve_alias_and_empty_precedence() {
    let work = tempfile::tempdir().unwrap();
    let mut variables = BTreeMap::from([
        ("HOME".into(), work.path().as_os_str().to_owned()),
        ("LLAMA_CHAT_TEMPLATE_FILE".into(), "/legacy.jinja".into()),
        ("MIR_CHAT_TEMPLATE_FILE".into(), "/mir.jinja".into()),
        ("STRAGGLER_CHAT_TEMPLATE_FILE".into(), "".into()),
        ("MIR_MTP".into(), "model".into()),
        ("STRAGGLER_MTP".into(), "file".into()),
        ("STRAGGLER_MTP_FILE".into(), "/selected.gguf".into()),
    ]);
    let environment = Environment::from_variables(variables.clone(), None).unwrap();
    let settings = Settings::from_environment(&environment).unwrap();
    assert_eq!(settings.chat_template_file, "");
    assert_eq!(settings.mtp, "file");
    assert_eq!(settings.mtp_file, "/selected.gguf");
    variables.insert("STRAGGLER_MTP".into(), "".into());
    let environment = Environment::from_variables(variables, None).unwrap();
    assert!(Settings::from_environment(&environment).is_err());
}
