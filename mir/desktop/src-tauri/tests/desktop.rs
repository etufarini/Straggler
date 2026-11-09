use mir_desktop::{ChatMessage, ChatRequest, Runtime};
use std::{
    fs,
    net::TcpListener,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

struct Fixture {
    _directory: tempfile::TempDir,
    launcher: PathBuf,
    data: PathBuf,
    model: String,
    record: PathBuf,
    port: u16,
    reservation: Mutex<Option<TcpListener>>,
}

fn quote(path: impl AsRef<std::path::Path>) -> String {
    format!(
        "'{}'",
        path.as_ref().to_str().unwrap().replace('\'', "'\"'\"'")
    )
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let models = root.join("models with spaces");
        fs::create_dir(&models).unwrap();
        let model = models.join("model ' $(touch unsafe).gguf");
        fs::write(&model, []).unwrap();
        let llama = root.join("llama.cpp");
        fs::create_dir_all(llama.join("build/bin")).unwrap();
        let server = llama.join("build/bin/llama-server");
        fs::write(&server, include_str!("../../tests/fixtures/server.py")).unwrap();
        fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
        let reservation = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = reservation.local_addr().unwrap().port();
        let launcher = root.join("launcher.sh");
        let original = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../mir.sh")
            .canonicalize()
            .unwrap();
        let record = root.join("request.json");
        fs::write(&launcher, format!("#!/usr/bin/env bash\nexec env -i PATH=\"$PATH\" HOME={} XDG_CONFIG_HOME={} MIR_LLAMA_CPP_DIR={} MIR_MODELS_DIR={} MIR_PORT={} TEST_REQUEST={} bash {} \"$@\"\n",
            quote(root), quote(root.join("config")), quote(llama), quote(models), port, quote(&record), quote(original))).unwrap();
        Self {
            launcher,
            data: root.join("data"),
            model: model.to_str().unwrap().into(),
            record,
            port,
            reservation: Mutex::new(Some(reservation)),
            _directory: directory,
        }
    }

    fn release_port(&self) {
        self.reservation.lock().unwrap().take();
    }

    fn runtime(&self) -> Arc<Runtime> {
        Arc::new(Runtime::new(self.launcher.clone(), self.data.clone()).unwrap())
    }

    fn mock_build(&self) -> PathBuf {
        let root = self._directory.path();
        let commands = root.join("build commands");
        let control = root.join("build control");
        fs::create_dir_all(&commands).unwrap();
        fs::create_dir_all(&control).unwrap();
        let scripts = [
            ("git", include_str!("../../tests/fixtures/build-git.sh")),
            ("cmake", include_str!("../../tests/fixtures/build-cmake.sh")),
            (
                "dpkg-query",
                "#!/usr/bin/env bash\nif [[ -f \"$TEST_BUILD_CONTROL/missing\" && $* == *libssl-dev* ]]; then exit 1; fi\nprintf 'install ok installed'\n",
            ),
            ("glslc", "#!/usr/bin/env bash\nexit 0\n"),
            ("vulkaninfo", "#!/usr/bin/env bash\nexit 0\n"),
            ("nvcc", "#!/usr/bin/env bash\nexit 0\n"),
            (
                "pkexec",
                "#!/usr/bin/env bash\nprintf 'Unexpected privilege request' >&2\nexit 1\n",
            ),
        ];
        for (name, source) in scripts {
            let file = commands.join(name);
            fs::write(&file, source).unwrap();
            fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let original = fs::read_to_string(&self.launcher).unwrap();
        fs::write(
            &self.launcher,
            original.replace(
                "exec env -i PATH=\"$PATH\"",
                &format!(
                    "exec env -i PATH={}:\"$PATH\" TEST_BUILD_CONTROL={} TEST_BUILD_SERVER={}",
                    quote(commands),
                    quote(&control),
                    quote(root.join("llama.cpp/build/bin/llama-server"))
                ),
            ),
        )
        .unwrap();
        control
    }

    async fn ready(&self, runtime: &Runtime) {
        self.release_port();
        runtime.start(self.model.clone()).unwrap();
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let status = runtime.status().await.unwrap();
                assert_ne!(status.phase, "error", "{:?}", status.logs);
                if status.phase == "ready" {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
        })
        .await
        .unwrap();
    }
}

async fn wait_build(runtime: &Runtime, expected: &str) {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let status = runtime.job_status().unwrap();
            if status.phase == expected {
                break;
            }
            assert_ne!(status.phase, "failed", "{:?}", status.logs);
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
}

fn request(id: Uuid, content: &str) -> ChatRequest {
    ChatRequest {
        request_id: id,
        messages: vec![ChatMessage {
            role: "user".into(),
            content: content.into(),
        }],
    }
}

#[tokio::test]
async fn actual_launcher_bridge_stream_and_owned_shutdown() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let config = runtime.inspect().unwrap();
    assert_eq!(config.models[0].path, fixture.model);
    assert!(config.server_available);
    assert!(Runtime::new(fixture.launcher.clone(), fixture.data.clone()).is_err());
    fixture.ready(&runtime).await;
    assert!(runtime.start(fixture.model.clone()).is_err());
    let mut content = String::new();
    let result = runtime
        .generate(request(Uuid::new_v4(), "hello"), |delta| {
            content += &delta.content;
            Ok(())
        })
        .await
        .unwrap();
    assert_eq!(result, "complete");
    assert_eq!(content, "caffè ☕");
    let recorded: serde_json::Value =
        serde_json::from_slice(&fs::read(&fixture.record).unwrap()).unwrap();
    assert_eq!(recorded["messages"][0]["content"], "hello");
    assert!(recorded.get("temperature").is_none());
    assert!(recorded.get("max_tokens").is_none());
    assert!(!fixture._directory.path().join("unsafe").exists());
    runtime.stop().unwrap();
    assert_eq!(runtime.status().await.unwrap().phase, "stopped");
    assert!(TcpListener::bind(("127.0.0.1", fixture.port)).is_ok());
}

async fn wait_phase(runtime: &Runtime, phase: &str) -> mir_desktop::Status {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let status = runtime.status().await.unwrap();
            if status.phase == phase {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn fatal_memory_failure_survives_health_checks_until_a_new_server_run() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    fixture.ready(&runtime).await;
    let mut partial = String::new();
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        runtime.generate(request(Uuid::new_v4(), "oom-stream"), |delta| {
            partial += &delta.content;
            fs::write(format!("{}.continue", fixture.record.display()), []).unwrap();
            Ok(())
        }),
    )
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(partial, "caffè ☕");
    let status = wait_phase(&runtime, "needs-restart").await;
    assert_eq!(
        status.issue.unwrap().kind,
        mir_desktop::diagnostics::IssueKind::Memory
    );
    // The fixture continues to advertise health after its backend has failed.
    assert!(
        reqwest::get(format!("http://127.0.0.1:{}/health", fixture.port))
            .await
            .unwrap()
            .status()
            .is_success()
    );
    assert_eq!(runtime.status().await.unwrap().phase, "needs-restart");
    assert!(runtime
        .generate(request(Uuid::new_v4(), "hello"), |_| Ok(()))
        .await
        .unwrap_err()
        .contains("restarted"));
    runtime.stop().unwrap();
    let stopped = runtime.status().await.unwrap();
    assert_eq!(stopped.phase, "stopped");
    assert!(stopped.issue.is_some());
    fixture.ready(&runtime).await;
    assert!(runtime.status().await.unwrap().issue.is_none());
    assert_eq!(
        runtime
            .generate(request(Uuid::new_v4(), "hello"), |_| Ok(()))
            .await
            .unwrap(),
        "complete"
    );
    runtime.stop().unwrap();
}

#[tokio::test]
async fn startup_and_request_oom_are_distinguished_from_recoverable_errors() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    fixture.ready(&runtime).await;
    assert_eq!(
        runtime
            .generate(request(Uuid::new_v4(), "memory-warning"), |_| Ok(()))
            .await
            .unwrap(),
        "complete"
    );
    assert_eq!(runtime.status().await.unwrap().phase, "ready");
    runtime.stop().unwrap();
    fixture.ready(&runtime).await;
    assert!(runtime
        .generate(request(Uuid::new_v4(), "compute-error"), |_| Ok(()))
        .await
        .unwrap_err()
        .contains("Compute error"));
    assert!(runtime.status().await.unwrap().issue.is_none());
    assert!(runtime
        .generate(request(Uuid::new_v4(), "oom"), |_| Ok(()))
        .await
        .is_err());
    wait_phase(&runtime, "needs-restart").await;
    runtime.stop().unwrap();
    let launcher = fs::read_to_string(&fixture.launcher).unwrap();
    fs::write(
        &fixture.launcher,
        launcher.replace("TEST_REQUEST=", "TEST_SERVER_MODE=oom-init TEST_REQUEST="),
    )
    .unwrap();
    runtime.start(fixture.model.clone()).unwrap();
    let status = wait_phase(&runtime, "needs-restart").await;
    assert_eq!(
        status.issue.unwrap().kind,
        mir_desktop::diagnostics::IssueKind::Memory
    );
    runtime.stop().unwrap();
}

#[tokio::test]
async fn cancellation_before_and_during_stream_and_new_request() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    fixture.ready(&runtime).await;
    let early = Uuid::new_v4();
    runtime.cancel(early).unwrap();
    assert_eq!(
        runtime
            .generate(request(early, "hello"), |_| Ok(()))
            .await
            .unwrap(),
        "stopped"
    );
    let id = Uuid::new_v4();
    let partial = Arc::new(Mutex::new(String::new()));
    let task_runtime = runtime.clone();
    let task_partial = partial.clone();
    let (sent, received) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let mut sent = Some(sent);
        task_runtime
            .generate(request(id, "wait"), |delta| {
                task_partial.lock().unwrap().push_str(&delta.content);
                if let Some(sent) = sent.take() {
                    let _ = sent.send(());
                }
                Ok(())
            })
            .await
    });
    tokio::time::timeout(Duration::from_secs(3), received)
        .await
        .unwrap()
        .unwrap();
    assert!(runtime
        .generate(request(Uuid::new_v4(), "hello"), |_| Ok(()))
        .await
        .is_err());
    runtime.cancel(id).unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        "stopped"
    );
    assert_eq!(&*partial.lock().unwrap(), "caffè ☕");
    assert_eq!(
        runtime
            .generate(request(Uuid::new_v4(), "hello"), |_| Ok(()))
            .await
            .unwrap(),
        "complete"
    );
    runtime.stop().unwrap();
}

#[tokio::test]
async fn unsupported_chat_and_interrupted_stream_preserve_errors() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    fixture.ready(&runtime).await;
    assert!(runtime
        .generate(request(Uuid::new_v4(), "reject"), |_| Ok(()))
        .await
        .unwrap_err()
        .contains("Unsupported chat template"));
    let mut partial = String::new();
    let error = runtime
        .generate(request(Uuid::new_v4(), "interrupted"), |delta| {
            partial += &delta.content;
            Ok(())
        })
        .await
        .unwrap_err();
    assert!(error.contains("ended unexpectedly"));
    assert_eq!(partial, "caffè ☕");
    runtime.stop().unwrap();
}

#[tokio::test]
async fn occupied_port_never_stops_its_listener() {
    let fixture = Fixture::new();
    let external = fixture.reservation.lock().unwrap().take().unwrap();
    let runtime = fixture.runtime();
    assert!(runtime.inspect().unwrap().port_status.contains("IN USE"));
    fixture.release_port();
    runtime.start(fixture.model.clone()).unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let status = runtime.status().await.unwrap();
            if status.phase == "error" {
                assert!(status.logs.join("\n").contains("IN USE"));
                break;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    runtime.stop().unwrap();
    assert!(std::net::TcpStream::connect(external.local_addr().unwrap()).is_ok());
}

#[tokio::test]
async fn full_configuration_profiles_and_folder_changes_are_transactional() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let initial = runtime.inspect().unwrap();
    assert_eq!(initial.settings.temperature, "auto");
    assert_eq!(initial.devices[0].name, "Test0");
    let mut settings = initial.settings;
    settings.temperature = "0.6".into();
    settings.top_p = "0.95".into();
    settings.top_k = "20".into();
    settings.min_p = "0".into();
    settings.repeat_penalty = "1".into();
    settings.presence_penalty = "0".into();
    settings.frequency_penalty = "0".into();
    settings.seed = "42".into();
    settings.max_tokens = "512".into();
    let focused = runtime.configure(settings.clone()).unwrap();
    assert_eq!(focused.generation_preset, "focused");
    let saved = runtime
        .workspace_action(
            "save-profile",
            vec!["My profile".into(), "new".into()],
            vec![],
        )
        .unwrap();
    assert_eq!(saved["currentProfile"], "My profile");
    assert_eq!(saved["modified"], false);
    settings.context = "1024".into();
    settings.threads = "2".into();
    let edited = runtime.configure(settings.clone()).unwrap();
    assert!(edited.modified);
    let mut invalid = settings.clone();
    invalid.threads = "0".into();
    assert!(runtime.configure(invalid).is_err());
    assert_eq!(runtime.inspect().unwrap().settings, settings);
    assert!(runtime
        .workspace_action(
            "save-profile",
            vec!["My profile".into(), "new".into()],
            vec![]
        )
        .is_err());
    let restored = runtime
        .workspace_action("load-profile", vec!["My profile".into()], vec![])
        .unwrap();
    assert_eq!(restored["settings"]["context"], "auto");
    assert_eq!(restored["settings"]["seed"], "42");
    assert_eq!(restored["modified"], false);
    assert!(runtime
        .workspace_action("load-profile", vec!["../escape".into()], vec![])
        .is_err());
    assert_eq!(
        runtime.inspect().unwrap().current_profile.as_deref(),
        Some("My profile")
    );
    let deleted = runtime
        .workspace_action(
            "delete-profile",
            vec!["My profile".into(), "confirm".into()],
            vec![],
        )
        .unwrap();
    assert!(deleted["currentProfile"].is_null());
    assert_eq!(deleted["settings"]["seed"], "42");

    let directory = fixture._directory.path().join("empty models");
    fs::create_dir_all(directory.join(".hidden")).unwrap();
    let folder = runtime
        .workspace_action(
            "browse",
            vec![directory.to_str().unwrap().into(), "false".into()],
            vec![],
        )
        .unwrap();
    assert!(folder["directories"].as_array().unwrap().is_empty());
    let folder = runtime
        .workspace_action(
            "browse",
            vec![directory.to_str().unwrap().into(), "true".into()],
            vec![],
        )
        .unwrap();
    assert_eq!(folder["directories"][0]["name"], ".hidden");
    let next = runtime
        .workspace_action(
            "set-path",
            vec!["models".into(), directory.to_str().unwrap().into()],
            vec![],
        )
        .unwrap();
    assert!(next["models"].as_array().unwrap().is_empty());
    assert_eq!(next["settings"]["model"], "");
    assert_eq!(
        runtime.inspect().unwrap().models_dir,
        directory.canonicalize().unwrap().to_str().unwrap()
    );
    assert!(runtime
        .workspace_action(
            "set-path",
            vec!["llama".into(), directory.to_str().unwrap().into()],
            vec![]
        )
        .is_err());
    assert!(runtime.inspect().unwrap().server_available);
}

#[tokio::test]
async fn explicit_settings_reach_the_server_and_pending_changes_require_restart() {
    let fixture = Fixture::new();
    let runtime = fixture.runtime();
    let mut settings = runtime.inspect().unwrap().settings;
    settings.context = "1024".into();
    settings.device = "none".into();
    settings.gpu_layers = "all".into();
    runtime.configure(settings.clone()).unwrap();
    fixture.ready(&runtime).await;
    assert_eq!(
        runtime.status().await.unwrap().running_settings.unwrap(),
        settings
    );
    settings.context = "2048".into();
    assert!(runtime.configure(settings).unwrap().restart_required);
    runtime.stop().unwrap();
    assert!(!runtime.inspect().unwrap().restart_required);
}

#[tokio::test]
async fn listeners_require_matching_identity_and_term_does_not_force_kill() {
    use std::process::{Command, Stdio};
    let fixture = Fixture::new();
    fixture.release_port();
    let script = "import signal,socket,time,sys;signal.signal(signal.SIGTERM,lambda *a:None);s=socket.socket();s.bind(('127.0.0.1',int(sys.argv[1])));s.listen();print('ready',flush=True);time.sleep(30)";
    let mut external = Command::new("python3")
        .args(["-u", "-c", script, &fixture.port.to_string()])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut ready = String::new();
    use std::io::BufRead;
    std::io::BufReader::new(external.stdout.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    let runtime = fixture.runtime();
    let targets = runtime.inspect().unwrap().listeners;
    assert!(targets.iter().any(|target| target.pid == external.id()));
    let mut stale = targets.clone();
    for target in &mut stale {
        target.identity = "stale identity".into();
    }
    runtime
        .workspace_action("stop-listeners", vec!["TERM".into()], stale)
        .unwrap();
    assert!(external.try_wait().unwrap().is_none());
    let remaining = runtime
        .workspace_action("stop-listeners", vec!["TERM".into()], targets.clone())
        .unwrap();
    assert!(!remaining["listeners"].as_array().unwrap().is_empty());
    assert!(external.try_wait().unwrap().is_none());
    runtime
        .workspace_action("stop-listeners", vec!["KILL".into()], targets)
        .unwrap();
    assert!(!external.wait().unwrap().success());
}

#[tokio::test]
async fn managed_build_update_restore_failure_and_cancellation_preserve_working_state() {
    let fixture = Fixture::new();
    let control = fixture.mock_build();
    let runtime = fixture.runtime();
    let settings = runtime.inspect().unwrap().settings;
    fs::write(control.join("missing"), []).unwrap();
    let plan = runtime
        .workspace_action("build-plan", vec!["cpu".into()], vec![])
        .unwrap();
    if cfg!(target_os = "macos") {
        assert_eq!(plan["packages"], serde_json::json!([]));
    } else {
        assert_eq!(plan["packages"], serde_json::json!(["libssl-dev"]));
    }
    fs::remove_file(control.join("missing")).unwrap();
    runtime
        .start_build("v1".into(), "cpu".into(), "2".into())
        .unwrap();
    wait_build(&runtime, "ready").await;
    let first = runtime.inspect().unwrap();
    assert_eq!(first.build["tag"], "v1");
    assert_eq!(first.settings, settings);
    let accelerator = if cfg!(target_os = "macos") {
        "metal"
    } else {
        "vulkan"
    };
    runtime
        .start_build("v2".into(), accelerator.into(), "2".into())
        .unwrap();
    wait_build(&runtime, "ready").await;
    let second = runtime.inspect().unwrap();
    assert_eq!(second.build["tag"], "v2");
    assert_eq!(second.build["backend"], accelerator);
    assert!(fs::read_to_string(control.join("commands"))
        .unwrap()
        .contains(if cfg!(target_os = "macos") {
            "-DGGML_METAL=ON"
        } else {
            "-DGGML_VULKAN=ON"
        }));
    runtime.workspace_action("restore", vec![], vec![]).unwrap();
    assert_eq!(runtime.inspect().unwrap().llama_dir, first.llama_dir);
    fs::write(control.join("fail"), []).unwrap();
    runtime
        .start_build("bad".into(), "cpu".into(), "2".into())
        .unwrap();
    wait_build(&runtime, "failed").await;
    assert_eq!(runtime.inspect().unwrap().llama_dir, first.llama_dir);
    fs::remove_file(control.join("fail")).unwrap();
    fs::write(control.join("pause"), []).unwrap();
    runtime
        .start_build("cancel".into(), "cpu".into(), "2".into())
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !control.join("worker").exists() {
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
    assert!(runtime.start(fixture.model.clone()).is_err());
    runtime.cancel_build().unwrap();
    assert_eq!(runtime.job_status().unwrap().phase, "canceled");
    assert_eq!(runtime.inspect().unwrap().llama_dir, first.llama_dir);
}
