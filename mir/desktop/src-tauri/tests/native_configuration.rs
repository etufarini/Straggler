use mir_desktop::{
    configuration::{
        environment::Environment,
        storage::{Paths, Store},
    },
    workspace::{ConfigurationError, Settings},
};
use std::{collections::BTreeMap, ffi::OsString, fs, path::Path};

fn environment(home: &Path, controls: &[(&str, &str)]) -> Environment {
    let mut variables = BTreeMap::from([(OsString::from("HOME"), home.as_os_str().to_owned())]);
    variables.extend(
        controls
            .iter()
            .map(|(name, value)| ((*name).into(), (*value).into())),
    );
    Environment::from_variables(variables, None).unwrap()
}

#[test]
fn defaults_and_environment_precedence_preserve_explicit_empty_controls() {
    let work = tempfile::tempdir().unwrap();
    let env = environment(
        work.path(),
        &[
            ("LLAMA_CTX_SIZE", "2048"),
            ("MIR_CTX_SIZE", "0"),
            ("MIR_GENERATION_PRESET", "focused"),
            ("MIR_SEED", "42"),
            ("LLAMA_ARG_SPLIT_MODE", "row"),
        ],
    );
    let settings = Settings::from_environment(&env).unwrap();
    assert_eq!(settings.context, "0");
    assert_eq!(settings.seed, "42");
    assert_eq!(settings.max_tokens, "auto");
    assert_eq!(settings.split_mode, "auto");
    assert_eq!(settings.generation_preset(), "focused");
    let env = environment(work.path(), &[("LLAMA_THREADS", "4"), ("MIR_THREADS", "")]);
    let failure = ConfigurationError::from(Settings::from_environment(&env).unwrap_err());
    assert_eq!(failure.field.as_deref(), Some("threads"));
    let env = environment(
        work.path(),
        &[
            ("MIR_LLAMA_CPP_DIR", ""),
            ("LLAMA_CPP_DIR", "/legacy"),
            ("MIR_MODELS_DIR", ""),
            ("LLAMA_MODELS_DIR", "/legacy models"),
        ],
    );
    let paths = Store::new(env).unwrap().paths();
    assert!(paths.llama.is_empty() && paths.models.is_empty());
}

#[test]
fn validation_covers_native_ranges_and_keeps_field_identifiers() {
    for (field, valid, invalid) in [
        ("context", "2147483647", "2147483648"),
        ("port", "06535", "65536"),
        ("threads", "1", "0"),
        ("top_p", "1.000000000", "1.000000001"),
        ("seed", "4294967295", "4294967296"),
        ("max_tokens", "-1", "-2"),
        ("repeat_penalty", "0.000000001", "0"),
        ("tensor_split", "0,1.5", "0,0.0"),
        ("fit_target", "0,2147483647", "0.5"),
        ("cache_type_k", "q4_0", "Q4_0"),
        ("chat_reasoning_effort", "very_high", "high$(touch unsafe)"),
    ] {
        let mut fields = Settings::default().fields();
        fields.insert(field.into(), valid.into());
        assert!(
            Settings::from_fields(fields.clone())
                .unwrap()
                .validated()
                .is_ok(),
            "{field}: {valid}"
        );
        fields.insert(field.into(), invalid.into());
        let failure = ConfigurationError::from(
            Settings::from_fields(fields)
                .unwrap()
                .validated()
                .unwrap_err(),
        );
        assert_eq!(failure.field.as_deref(), Some(field));
    }
}

#[test]
fn legacy_profiles_use_independent_defaults_and_round_trip_literal_prompts() {
    let profile = "model=/a/model.gguf\ncontext=1024\nremoved_option=$(touch unsafe)\n";
    let mut settings = Settings::from_profile(profile).unwrap();
    assert_eq!(settings.cache_type_v, "q4_0");
    assert_eq!(settings.port, "9931");
    assert_eq!(settings.temperature, "auto");
    settings.chat_system_prompt = "Literal $(touch unsafe)\nUnicode: caffè ☕".into();
    assert_eq!(
        Settings::from_profile(&settings.profile_data().unwrap()).unwrap(),
        settings
    );
    assert!(Settings::from_profile(&format!("{profile}context=2048\n")).is_err());
    assert!(Settings::from_profile("model=/a.gguf\nthreads=0\n").is_err());
    assert!(Settings::from_profile("context=1024\n").is_err());
}

#[test]
fn migration_preserves_originals_and_never_merges_existing_settings() {
    let work = tempfile::tempdir().unwrap();
    let env = environment(work.path(), &[]);
    let legacy = work.path().join(".config/llama-launcher");
    fs::create_dir_all(legacy.join("profiles")).unwrap();
    fs::write(
        legacy.join("paths.conf"),
        "llama_dir=/old\nmodels_dir=/models\n",
    )
    .unwrap();
    fs::write(legacy.join("profiles/Old.conf"), "model=/old.gguf\n").unwrap();
    let store = Store::new(env.clone()).unwrap();
    assert_eq!(store.paths().llama, "/old");
    assert_eq!(store.profiles().unwrap(), ["Old"]);
    assert!(legacy.join("profiles/Old.conf").is_file());
    fs::write(legacy.join("profiles/New.conf"), "model=/new.gguf\n").unwrap();
    let store = Store::new(env).unwrap();
    assert_eq!(store.profiles().unwrap(), ["Old"]);
}

#[test]
fn saves_are_literal_atomic_and_require_overwrite_and_delete_confirmation() {
    let work = tempfile::tempdir().unwrap();
    let env = environment(work.path(), &[]);
    let config = env.config.clone();
    let store = Store::new(env).unwrap();
    let model = work.path().join("model ' $(touch unsafe).gguf");
    fs::write(&model, []).unwrap();
    let mut settings = Settings {
        model: model.to_str().unwrap().into(),
        ..Settings::default()
    };
    store.save_profile("My profile", &settings, false).unwrap();
    let file = config.join("profiles/My profile.conf");
    let original = fs::read(&file).unwrap();
    settings.threads = "2".into();
    assert!(store.save_profile("My profile", &settings, false).is_err());
    assert_eq!(fs::read(&file).unwrap(), original);
    store.save_profile("My profile", &settings, true).unwrap();
    assert_eq!(store.load_profile("My profile").unwrap(), settings);
    assert!(store.delete_profile("My profile", false).is_err());
    assert!(store.save_profile("../escape", &settings, false).is_err());
    assert!(!work.path().join("unsafe").exists());
    let paths = Paths {
        llama: "/literal ' $(touch unsafe)".into(),
        models: work.path().to_str().unwrap().into(),
        warning: String::new(),
    };
    store.save_paths(&paths).unwrap();
    assert_eq!(store.paths().llama, paths.llama);
    fs::remove_file(config.join("paths.conf")).unwrap();
    fs::create_dir(config.join("paths.conf")).unwrap();
    assert!(store.save_paths(&paths).is_err());
    assert_eq!(store.load_profile("My profile").unwrap(), settings);
    store.delete_profile("My profile", true).unwrap();
    assert!(store.profiles().unwrap().is_empty());
}
