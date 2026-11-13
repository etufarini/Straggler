use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use straggler_desktop::bundled_backend::{bundled_server, check_command, check_model};

struct Fixture {
    directory: tempfile::TempDir,
    server: PathBuf,
    model: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let server = directory.path().join("backend with spaces");
        fs::write(
            &server,
            include_bytes!("../../tests/fixtures/backend-check-server.py"),
        )
        .unwrap();
        fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
        let model = directory.path().join("model ' $(touch unsafe).gguf");
        fs::write(&model, b"fixture; not a model").unwrap();
        Self {
            directory,
            server,
            model,
        }
    }

    fn flag(&self, name: &str) {
        fs::write(self.directory.path().join(name), b"").unwrap();
    }

    fn assert_reaped(&self) {
        let pid: i32 = fs::read_to_string(self.directory.path().join("pid.txt"))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            unsafe { libc::kill(pid, 0) },
            -1,
            "backend PID {pid} leaked"
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }

    async fn cancel_when_started(&self, cancelled: &AtomicBool) {
        // The fixture writes its PID after installing its signal handler.
        // File creation alone can precede that completed readiness record.
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let ready = fs::read_to_string(self.directory.path().join("pid.txt"))
                    .ok()
                    .and_then(|value| value.parse::<u32>().ok())
                    .is_some_and(|pid| pid > 0);
                if ready {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("Backend fixture did not become ready for cancellation");
        cancelled.store(true, Ordering::Relaxed);
    }
}

#[tokio::test]
async fn commands_capture_loader_failures_and_bound_returned_logs() {
    let fixture = Fixture::new();
    let cancelled = AtomicBool::new(false);
    let mut force = |_| panic!("Short diagnostics must not need SIGKILL");
    let help = check_command(
        &fixture.server,
        "--help",
        &cancelled,
        Duration::from_secs(5),
        &mut force,
    )
    .await;
    assert!(help.success, "{help:?}");
    assert!(help.logs.len() <= 32768);
    assert!(help.logs.ends_with("Fixture help tail\n"));
    fixture.assert_reaped();
    fixture.flag("version-error");
    let version = check_command(
        &fixture.server,
        "--version",
        &cancelled,
        Duration::from_secs(5),
        &mut force,
    )
    .await;
    assert!(!version.success);
    assert!(version.logs.contains("Fixture loader failure"));
    assert!(version.error.unwrap().contains("exited"));
    fixture.assert_reaped();
}

#[tokio::test]
async fn model_check_passes_literal_paths_and_stops_its_loopback_server() {
    let fixture = Fixture::new();
    let result = check_model(
        &fixture.server,
        &fixture.model,
        &AtomicBool::new(false),
        Duration::from_secs(5),
        &mut |_| panic!("The fixture must stop with SIGTERM"),
    )
    .await;
    assert!(result.success, "{result:?}");
    fixture.assert_reaped();
    let arguments: Vec<String> =
        serde_json::from_slice(&fs::read(fixture.directory.path().join("args.json")).unwrap())
            .unwrap();
    assert_eq!(arguments[1], fixture.model.to_str().unwrap());
    assert!(!fixture.directory.path().join("unsafe").exists());
    let index = arguments
        .iter()
        .position(|arg| arg == "--gpu-layers")
        .unwrap();
    assert_eq!(arguments[index + 1], "0");
    let index = arguments.iter().position(|arg| arg == "--port").unwrap();
    let port: u16 = arguments[index + 1].parse().unwrap();
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
}

#[tokio::test]
async fn model_load_errors_and_loading_timeouts_keep_the_backend_log_and_cleanup() {
    for loading in [false, true] {
        let fixture = Fixture::new();
        if loading {
            fixture.flag("loading");
        } else {
            fs::remove_file(&fixture.model).unwrap();
        }
        let result = check_model(
            &fixture.server,
            &fixture.model,
            &AtomicBool::new(false),
            Duration::from_secs(5),
            &mut |_| false,
        )
        .await;
        assert!(!result.success);
        assert!(result
            .error
            .unwrap()
            .contains(if loading { "timed out" } else { "exited" }));
        if !loading {
            assert!(result.logs.contains("Fixture model is missing"));
        }
        fixture.assert_reaped();
    }
}

#[tokio::test]
async fn cancellation_and_timeout_reap_owned_processes() {
    for cancel in [false, true] {
        let fixture = Fixture::new();
        fixture.flag("wait");
        let cancelled = AtomicBool::new(false);
        let cancellation = async {
            if cancel {
                fixture.cancel_when_started(&cancelled).await;
            }
        };
        let mut refuse_force = |_| false;
        let check = check_command(
            &fixture.server,
            "--version",
            &cancelled,
            Duration::from_secs(5),
            &mut refuse_force,
        );
        let (result, ()) = tokio::join!(check, cancellation);
        assert!(!result.success);
        assert!(result
            .error
            .unwrap()
            .contains(if cancel { "cancelled" } else { "timed out" }));
        fixture.assert_reaped();
    }
}

#[tokio::test]
async fn sigkill_requires_a_separate_confirmation_after_sigterm() {
    let fixture = Fixture::new();
    fixture.flag("wait");
    fixture.flag("ignore-term");
    let mut confirmations = 0;
    let cancelled = AtomicBool::new(false);
    let mut confirm_force = |pid: u32| {
        confirmations += 1;
        assert_eq!(
            fs::read_to_string(fixture.directory.path().join("pid.txt")).unwrap(),
            pid.to_string()
        );
        true
    };
    let check = check_command(
        &fixture.server,
        "--version",
        &cancelled,
        Duration::from_secs(10),
        &mut confirm_force,
    );
    let (result, ()) = tokio::join!(check, fixture.cancel_when_started(&cancelled));
    assert!(!result.success);
    assert_eq!(confirmations, 1);
    fixture.assert_reaped();
}

#[tokio::test]
async fn missing_resources_and_unsupported_commands_fail_explicitly() {
    let fixture = Fixture::new();
    assert!(bundled_server(&fixture.directory.path().join("straggler-desktop")).is_err());
    let result = check_command(
        &fixture.directory.path().join("missing"),
        "--version",
        &AtomicBool::new(false),
        Duration::from_secs(1),
        &mut |_| false,
    )
    .await;
    assert!(result.error.unwrap().contains("Cannot execute"));
    let result = check_command(
        &fixture.server,
        "--unexpected",
        &AtomicBool::new(false),
        Duration::from_secs(1),
        &mut |_| false,
    )
    .await;
    assert!(result.error.unwrap().contains("Unsupported"));
}
