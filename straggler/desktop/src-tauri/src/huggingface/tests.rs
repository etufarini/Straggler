use super::{
    api::{HubClient, RemoteFile},
    catalog,
    credentials::{MemoryTokenStore, TokenStore},
    downloads::{Download, DownloadPlan, Downloads},
    HuggingFace,
};
use crate::configuration::models;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use uuid::Uuid;

const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[derive(Default)]
struct Behavior {
    ignore_range: bool,
    invalid_range: bool,
    interrupt_once: bool,
    corrupt: bool,
    gated: bool,
    redirect: Option<String>,
}
struct State {
    files: BTreeMap<String, Vec<u8>>,
    requests: Vec<(String, Option<u64>, bool)>,
    behavior: Behavior,
}
struct HubFixture {
    base: String,
    state: Arc<Mutex<State>>,
    stopped: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl HubFixture {
    fn new(files: BTreeMap<String, Vec<u8>>, behavior: Behavior) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(State {
            files,
            requests: Vec::new(),
            behavior,
        }));
        let stopped = Arc::new(AtomicBool::new(false));
        let (server_state, server_stopped, server_base) =
            (state.clone(), stopped.clone(), base.clone());
        let worker = thread::spawn(move || {
            let mut workers = Vec::new();
            for stream in listener.incoming() {
                if server_stopped.load(Ordering::Relaxed) {
                    break;
                }
                let (state, base) = (server_state.clone(), server_base.clone());
                workers.push(thread::spawn(move || serve(stream.unwrap(), state, base)));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        Self {
            base,
            state,
            stopped,
            worker: Some(worker),
        }
    }
    fn standard(behavior: Behavior) -> Self {
        Self::new(
            BTreeMap::from([("model.gguf".into(), vec![b'G'; 512 * 1024])]),
            behavior,
        )
    }
    fn hub(&self, token: Option<&str>) -> HubClient {
        let store = Arc::new(MemoryTokenStore::default());
        store.write(token).unwrap();
        HubClient::loopback_fixture(store, &self.base).unwrap()
    }
}

impl Drop for HubFixture {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(
            self.base
                .trim_start_matches("http://")
                .trim_end_matches('/'),
        );
        self.worker.take().unwrap().join().unwrap();
    }
}

fn serve(mut stream: TcpStream, state: Arc<Mutex<State>>, base: String) {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut first = String::new();
    if reader.read_line(&mut first).unwrap_or(0) == 0 {
        return;
    }
    let path = first.split_whitespace().nth(1).unwrap().to_owned();
    let mut range = None;
    let mut authenticated = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
            break;
        }
        let line = line.trim();
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
            range = value
                .strip_suffix('-')
                .and_then(|offset| offset.parse::<u64>().ok());
        }
        if line == "authorization: Bearer hf_private_fixture" {
            authenticated = true;
        }
    }
    let (status, headers, mut body, interrupt, slow) = {
        let mut state = state.lock().unwrap();
        state.requests.push((path.clone(), range, authenticated));
        if path.starts_with("/api/models?") {
            assert!(path.contains("filter=gguf"));
            (
                200,
                String::new(),
                serde_json::to_vec(
                    &json!([{"id":"publisher/repository","downloads":12,"gated":false}]),
                )
                .unwrap(),
                false,
                false,
            )
        } else if path.contains("/revision/") {
            (
                200,
                String::new(),
                serde_json::to_vec(&json!({"sha":COMMIT,"gated":state.behavior.gated})).unwrap(),
                false,
                false,
            )
        } else if path.contains("/tree/") {
            let rows: Vec<_> = state.files.iter().map(|(path, bytes)| json!({"type":"file","path":path,"size":bytes.len(),"lfs":{"oid":format!("{:x}",Sha256::digest(bytes)),"size":bytes.len(),"pointerSize":123}})).collect();
            (
                200,
                String::new(),
                serde_json::to_vec(&rows).unwrap(),
                false,
                false,
            )
        } else if let Some((_, file)) = path.split_once(&format!("/resolve/{COMMIT}/")) {
            if let Some(redirect) = &state.behavior.redirect {
                (
                    302,
                    format!("Location: {redirect}\r\n"),
                    Vec::new(),
                    false,
                    false,
                )
            } else if state.behavior.gated && !authenticated {
                (403, String::new(), b"restricted".to_vec(), false, false)
            } else {
                let original = state.files.get(file).unwrap().clone();
                let offset = if state.behavior.ignore_range {
                    0
                } else {
                    range.unwrap_or(0)
                } as usize;
                let mut bytes = original[offset..].to_vec();
                if state.behavior.corrupt {
                    bytes.fill(b'X');
                }
                let status = if range.is_some() && !state.behavior.ignore_range {
                    206
                } else {
                    200
                };
                let start = offset + usize::from(state.behavior.invalid_range);
                let headers = if status == 206 {
                    format!(
                        "Content-Range: bytes {start}-{}/{total}\r\n",
                        original.len() - 1,
                        total = original.len()
                    )
                } else {
                    String::new()
                };
                let interrupt = state.behavior.interrupt_once;
                state.behavior.interrupt_once = false;
                (status, headers, bytes, interrupt, true)
            }
        } else {
            panic!("Unexpected fixture URL: {base}{path}");
        }
    };
    let length = body.len();
    if interrupt {
        body.truncate(length / 2);
    }
    if write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Length: {length}\r\n{headers}Connection: close\r\n\r\n").is_err() { return; }
    for chunk in body.chunks(4096) {
        if stream.write_all(chunk).is_err() {
            return;
        }
        if slow {
            thread::sleep(Duration::from_millis(2));
        }
    }
}

async fn wait_for(downloads: &Downloads, id: Uuid, phase: &str) -> Download {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let download = downloads
                .list()
                .unwrap()
                .into_iter()
                .find(|download| download.id == id)
                .unwrap();
            if download.phase == phase {
                break download;
            }
            if phase == "completed" {
                assert_ne!(download.phase, "error", "{:?}", download.error);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap()
}

async fn plan(hub: &HubClient) -> DownloadPlan {
    let repository = hub
        .repository("publisher/repository", "main", None)
        .await
        .unwrap();
    DownloadPlan::selected(&repository, &["model.gguf".into()]).unwrap()
}

#[tokio::test]
async fn hub_requests_are_explicit_and_credentials_never_enter_saved_download_state() {
    let fixture = HubFixture::standard(Behavior::default());
    let root = tempfile::tempdir().unwrap();
    let service =
        HuggingFace::with_hub(root.path(), fixture.hub(Some("hf_private_fixture"))).unwrap();
    assert!(fixture.state.lock().unwrap().requests.is_empty());
    assert!(service.downloads.list().unwrap().is_empty());
    let results = service.search("example").await.unwrap();
    assert_eq!(results.repositories[0].id, "publisher/repository");
    let repository = service
        .repository("publisher/repository", "main")
        .await
        .unwrap();
    assert_eq!(repository.variants[0].parts, 1);
    let models = root.path().join("models");
    std::fs::create_dir(&models).unwrap();
    let id = service
        .download(
            "publisher/repository",
            COMMIT,
            &["model.gguf".into()],
            models,
        )
        .unwrap();
    wait_for(&service.downloads, id, "completed").await;
    let ledger = std::fs::read_to_string(root.path().join("downloads.json")).unwrap();
    assert!(!ledger.contains("hf_private_fixture"));
    assert!(fixture
        .state
        .lock()
        .unwrap()
        .requests
        .iter()
        .all(|request| request.2));
}

#[tokio::test]
async fn paused_downloads_survive_restart_and_resume_range_without_automatic_network() {
    for ignore_range in [false, true] {
        let fixture = HubFixture::standard(Behavior {
            ignore_range,
            ..Behavior::default()
        });
        let hub = fixture.hub(None);
        let root = tempfile::tempdir().unwrap();
        let downloads = Arc::new(Downloads::new(&root.path().join("state")));
        let models = root.path().join("models");
        std::fs::create_dir(&models).unwrap();
        let id = downloads
            .start(plan(&hub).await, models.clone(), hub.clone())
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while downloads.list().unwrap()[0].downloaded == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        downloads.control(id, false).unwrap();
        wait_for(&downloads, id, "paused").await;
        let partial = models.join("publisher/repository/model.gguf.part");
        let offset = std::fs::metadata(&partial).unwrap().len();
        assert!(offset > 0 && offset < 512 * 1024);
        let requests = fixture.state.lock().unwrap().requests.len();
        let restored = Arc::new(Downloads::new(&root.path().join("state")));
        assert_eq!(restored.list().unwrap()[0].phase, "paused");
        assert_eq!(fixture.state.lock().unwrap().requests.len(), requests);
        restored.resume(id, &models, hub).unwrap();
        wait_for(&restored, id, "completed").await;
        assert_eq!(
            std::fs::read(models.join("publisher/repository/model.gguf")).unwrap(),
            vec![b'G'; 512 * 1024]
        );
        assert!(!partial.exists());
        assert!(fixture
            .state
            .lock()
            .unwrap()
            .requests
            .iter()
            .any(|request| request.1 == Some(offset)));
    }
}

#[tokio::test]
async fn interruption_invalid_range_checksum_and_cancel_preserve_destination_contracts() {
    let fixture = HubFixture::standard(Behavior {
        interrupt_once: true,
        ..Behavior::default()
    });
    let hub = fixture.hub(None);
    let root = tempfile::tempdir().unwrap();
    let downloads = Arc::new(Downloads::new(&root.path().join("state")));
    let models = root.path().join("models");
    std::fs::create_dir(&models).unwrap();
    let id = downloads
        .start(plan(&hub).await, models.clone(), hub.clone())
        .unwrap();
    wait_for(&downloads, id, "error").await;
    assert!(!models.join("publisher/repository/model.gguf").exists());
    fixture.state.lock().unwrap().behavior.invalid_range = true;
    downloads.resume(id, &models, hub.clone()).unwrap();
    assert!(wait_for(&downloads, id, "error")
        .await
        .error
        .unwrap()
        .contains("resume range"));
    fixture.state.lock().unwrap().behavior.invalid_range = false;
    fixture.state.lock().unwrap().behavior.corrupt = true;
    downloads.resume(id, &models, hub.clone()).unwrap();
    assert!(wait_for(&downloads, id, "error")
        .await
        .error
        .unwrap()
        .contains("SHA-256"));
    assert!(!models.join("publisher/repository/model.gguf.part").exists());
    fixture.state.lock().unwrap().behavior.corrupt = false;
    downloads.resume(id, &models, hub).unwrap();
    downloads.control(id, true).unwrap();
    wait_for(&downloads, id, "cancelled").await;
    assert!(!models.join("publisher/repository/model.gguf.part").exists());
    assert!(!models.join("publisher/repository/model.gguf").exists());
}

#[tokio::test]
async fn multipart_models_publish_only_after_all_digests_and_discover_one_entry_two_levels_down() {
    let files = BTreeMap::from([
        (
            "model-00001-of-00002.gguf".into(),
            b"first GGUF fixture".to_vec(),
        ),
        (
            "model-00002-of-00002.gguf".into(),
            b"second GGUF fixture".to_vec(),
        ),
    ]);
    let fixture = HubFixture::new(files, Behavior::default());
    let hub = fixture.hub(None);
    let repository = hub
        .repository("publisher/repository", "main", None)
        .await
        .unwrap();
    assert_eq!(repository.variants.len(), 1);
    assert_eq!(repository.variants[0].parts, 2);
    let root = tempfile::tempdir().unwrap();
    let manager = Arc::new(Downloads::new(&root.path().join("state")));
    let id = manager
        .start(
            DownloadPlan::selected(&repository, &[repository.variants[0].path.clone()]).unwrap(),
            root.path().to_owned(),
            hub,
        )
        .unwrap();
    wait_for(&manager, id, "completed").await;
    let discovered = models::discover(root.path()).unwrap();
    assert_eq!(discovered.len(), 1);
    assert!(discovered[0].path.ends_with("model-00001-of-00002.gguf"));
}

#[tokio::test]
async fn gated_downloads_and_untrusted_redirects_fail_without_exposing_tokens_or_creating_models() {
    for redirect in [None, Some("http://127.0.0.1:1/steal".into())] {
        let token = redirect.as_ref().map(|_| "hf_syntheticRedirectSecret");
        let fixture = HubFixture::standard(Behavior {
            gated: redirect.is_none(),
            redirect,
            ..Behavior::default()
        });
        let hub = fixture.hub(token);
        let plan = plan(&hub).await;
        let root = tempfile::tempdir().unwrap();
        let manager = Arc::new(Downloads::new(&root.path().join("state")));
        let id = manager.start(plan, root.path().to_owned(), hub).unwrap();
        let error = wait_for(&manager, id, "error").await.error.unwrap();
        assert!(!error.contains("127.0.0.1:1"));
        assert!(!error.contains("hf_syntheticRedirectSecret"));
        assert!(!root.path().join("publisher/repository/model.gguf").exists());
    }
}

#[tokio::test]
async fn storage_failures_foreign_partials_and_low_space_do_not_publish_or_start_transfers() {
    let fixture = HubFixture::standard(Behavior::default());
    let hub = fixture.hub(None);
    let plan = plan(&hub).await;
    let root = tempfile::tempdir().unwrap();
    let state = root.path().join("state");
    let manager = Arc::new(Downloads::new(&state));
    std::fs::write(&state, b"existing file blocks storage").unwrap();
    assert!(manager
        .start(plan.clone(), root.path().to_owned(), hub.clone())
        .is_err());
    assert!(manager.list().unwrap().is_empty());
    assert_eq!(
        std::fs::read(&state).unwrap(),
        b"existing file blocks storage"
    );
    std::fs::remove_file(&state).unwrap();

    let directory = root.path().join("publisher/repository");
    std::fs::create_dir_all(&directory).unwrap();
    let partial = directory.join("model.gguf.part");
    std::fs::write(&partial, b"unrelated partial").unwrap();
    assert!(manager
        .start(plan.clone(), root.path().to_owned(), hub.clone())
        .is_err());
    assert_eq!(std::fs::read(&partial).unwrap(), b"unrelated partial");
    std::fs::remove_file(&partial).unwrap();

    let mut oversized = plan;
    oversized.files[0].size =
        crate::platform::available_disk_bytes(&directory).unwrap() + 1024 * 1024 * 1024;
    let id = manager
        .start(oversized, root.path().to_owned(), hub)
        .unwrap();
    let error = wait_for(&manager, id, "error").await.error.unwrap();
    assert!(error.contains("disk space"), "{error}");
    assert!(!directory.join("model.gguf").exists());
    assert!(!fixture
        .state
        .lock()
        .unwrap()
        .requests
        .iter()
        .any(|(path, _, _)| path.contains("/resolve/")));
}

#[test]
fn catalogue_rejects_missing_parts_hashes_and_unsafe_paths_without_model_name_assumptions() {
    let file = RemoteFile {
        path: "arbitrary-00001-of-00002.gguf".into(),
        size: 1,
        sha256: Some("a".repeat(64)),
    };
    assert!(catalog::variants(std::slice::from_ref(&file))[0]
        .error
        .is_some());
    let file = RemoteFile {
        path: "arbitrary.gguf".into(),
        sha256: None,
        ..file
    };
    assert!(catalog::variants(std::slice::from_ref(&file))[0]
        .error
        .is_some());
    assert!(super::api::validate_remote_path("../outside.gguf").is_err());
    assert!(super::api::validate_repository("publisher/../../escape").is_err());
    let store = MemoryTokenStore::default();
    assert!(store.write(Some("hf_secret\nheader")).is_err());
    assert!(store.read().unwrap().is_none());
}
