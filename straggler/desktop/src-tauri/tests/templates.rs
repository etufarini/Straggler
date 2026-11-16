use std::{collections::BTreeMap, fs, path::Path};
use straggler_desktop::configuration::{environment::Environment, templates};

const HELP: &str = "--jinja\n--chat-template-file JINJA_TEMPLATE_FILE";

fn environment(root: &Path) -> Environment {
    Environment::from_variables(
        BTreeMap::from([("HOME".into(), root.as_os_str().to_owned())]),
        None,
    )
    .unwrap()
}

#[test]
fn sidecar_is_only_a_suggestion_and_explicit_files_can_have_any_name() {
    let work = tempfile::tempdir().unwrap();
    let model = work.path().join("weights.gguf");
    let template = work.path().join("chat_template.jinja");
    fs::write(&template, "{{ messages }}").unwrap();
    let environment = environment(work.path());
    assert_eq!(
        templates::candidate(&model),
        template.to_str().map(str::to_owned)
    );
    assert_eq!(
        templates::launch_file("", HELP, &environment).unwrap(),
        None
    );
    let selected = work.path().join("custom ' $(touch unsafe) ☕.j2");
    let content = "{{ messages[0].content }}\nLiteral $(touch unsafe) ☕";
    fs::write(&selected, content).unwrap();
    assert_eq!(
        templates::launch_file(selected.to_str().unwrap(), HELP, &environment).unwrap(),
        Some(selected.clone())
    );
    assert_eq!(fs::read_to_string(&selected).unwrap(), content);
    fs::remove_file(&selected).unwrap();
    assert!(templates::launch_file(selected.to_str().unwrap(), HELP, &environment).is_err());
    assert!(!work.path().join("unsafe").exists());
}

#[test]
fn native_template_overrides_skip_explicit_selection_even_when_empty() {
    let work = tempfile::tempdir().unwrap();
    for name in ["LLAMA_ARG_CHAT_TEMPLATE", "LLAMA_ARG_CHAT_TEMPLATE_FILE"] {
        for value in ["", "literal ' $(touch unsafe)"] {
            let mut environment = environment(work.path());
            environment.variables.insert(name.into(), value.into());
            assert_eq!(templates::native_override(&environment), name);
            assert_eq!(
                templates::launch_file("/missing/template.jinja", "", &environment).unwrap(),
                None
            );
            assert_eq!(environment.value(name).as_deref(), Some(value));
        }
    }
}

#[test]
fn custom_template_requires_both_advertised_options() {
    let work = tempfile::tempdir().unwrap();
    let template = work.path().join("custom.jinja");
    fs::write(&template, "{{ messages }}").unwrap();
    for (help, missing) in [
        ("", "--jinja"),
        ("--chat-template-file FILE", "--jinja"),
        (
            "--jinja\n--chat-template-file-other FILE",
            "--chat-template-file",
        ),
    ] {
        assert!(templates::launch_file(
            template.to_str().unwrap(),
            help,
            &environment(work.path())
        )
        .unwrap_err()
        .contains(&format!("does not advertise {missing},")));
    }
}

#[test]
fn unusable_templates_report_errors_without_falling_back() {
    let work = tempfile::tempdir().unwrap();
    let template = work.path().join("custom.jinja");
    for content in [b"".as_slice(), b" \n\t", b"\xff", b"Text\0"] {
        fs::write(&template, content).unwrap();
        assert!(templates::validate(&template).is_err());
    }
    fs::write(&template, vec![b'a'; 2 * 1024 * 1024 + 1]).unwrap();
    assert!(templates::validate(&template)
        .unwrap_err()
        .contains("2 MiB"));
    fs::remove_file(&template).unwrap();
    fs::create_dir(&template).unwrap();
    assert!(templates::validate(&template)
        .unwrap_err()
        .contains("readable file"));
    fs::remove_dir(&template).unwrap();
    std::os::unix::fs::symlink(work.path().join("missing.jinja"), &template).unwrap();
    assert!(templates::validate(&template).is_err());
}
