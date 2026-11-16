use std::{collections::BTreeMap, fs, path::Path};
use straggler_desktop::configuration::{environment::Environment, templates::launch_file};

const HELP: &str = "--jinja\n--chat-template-file JINJA_TEMPLATE_FILE";

fn environment(root: &Path) -> Environment {
    Environment::from_variables(
        BTreeMap::from([("HOME".into(), root.as_os_str().to_owned())]),
        None,
    )
    .unwrap()
}

#[test]
fn only_the_canonical_template_beside_the_selected_gguf_is_used() {
    let work = tempfile::tempdir().unwrap();
    let directory = work.path().join("model ' $(touch unsafe)");
    fs::create_dir(&directory).unwrap();
    let model = directory.join("weights.gguf");
    let environment = environment(work.path());
    for name in [
        "chat_template.embedded.jinja",
        "chat_template.upstream.jinja",
        "chat_template.unsloth.jinja",
        "._chat_template.jinja",
    ] {
        fs::write(directory.join(name), "Alternative").unwrap();
    }
    fs::write(work.path().join("chat_template.jinja"), "Parent").unwrap();
    assert_eq!(launch_file(&model, "", &environment).unwrap(), None);
    let template = directory.join("chat_template.jinja");
    let content = "{{ messages[0].content }}\nLiteral $(touch unsafe) ☕";
    fs::write(&template, content).unwrap();
    assert_eq!(
        launch_file(&model, HELP, &environment).unwrap(),
        Some(template.clone())
    );
    assert_eq!(
        launch_file(
            &directory.join("other-quantization.gguf"),
            HELP,
            &environment
        )
        .unwrap(),
        Some(template.clone())
    );
    assert_eq!(fs::read_to_string(&template).unwrap(), content);
    assert!(!work.path().join("unsafe").exists());
    fs::remove_file(template).unwrap();
    assert_eq!(launch_file(&model, HELP, &environment).unwrap(), None);
}

#[test]
fn native_template_overrides_skip_discovery_even_when_explicitly_empty() {
    let work = tempfile::tempdir().unwrap();
    let model = work.path().join("weights.gguf");
    // An unusable sidecar must not interfere with an explicit native override.
    fs::create_dir(work.path().join("chat_template.jinja")).unwrap();
    for name in ["LLAMA_ARG_CHAT_TEMPLATE", "LLAMA_ARG_CHAT_TEMPLATE_FILE"] {
        for value in ["", "literal ' $(touch unsafe)"] {
            let mut environment = environment(work.path());
            environment.variables.insert(name.into(), value.into());
            assert_eq!(launch_file(&model, "", &environment).unwrap(), None);
            assert_eq!(environment.value(name).as_deref(), Some(value));
        }
    }
}

#[test]
fn a_separate_template_requires_advertised_jinja_and_file_support() {
    let work = tempfile::tempdir().unwrap();
    let model = work.path().join("weights.gguf");
    fs::write(work.path().join("chat_template.jinja"), "{{ messages }}").unwrap();
    let environment = environment(work.path());
    for (help, missing) in [
        ("", "--jinja"),
        ("--chat-template-file FILE", "--jinja"),
        (
            "--jinja\n--chat-template-file-other FILE",
            "--chat-template-file",
        ),
    ] {
        let error = launch_file(&model, help, &environment).unwrap_err();
        assert!(
            error.contains(&format!("does not advertise {missing},")),
            "{error}"
        );
        assert!(error.contains("chat_template.jinja"));
    }
}

#[test]
fn unusable_templates_report_errors_instead_of_falling_back() {
    let work = tempfile::tempdir().unwrap();
    let environment = environment(work.path());
    let model = work.path().join("weights.gguf");
    let template = work.path().join("chat_template.jinja");
    for content in [b"".as_slice(), b" \n\t", b"\xff", b"Text\0"] {
        fs::write(&template, content).unwrap();
        assert!(launch_file(&model, HELP, &environment)
            .unwrap_err()
            .contains(template.to_str().unwrap()));
    }
    fs::remove_file(&template).unwrap();
    fs::create_dir(&template).unwrap();
    assert!(launch_file(&model, HELP, &environment)
        .unwrap_err()
        .contains("readable UTF-8 file"));
    fs::remove_dir(&template).unwrap();
    std::os::unix::fs::symlink(work.path().join("missing.jinja"), &template).unwrap();
    assert!(launch_file(&model, HELP, &environment)
        .unwrap_err()
        .contains("Cannot read chat template"));
}
