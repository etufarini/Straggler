use super::*;
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    thread,
};

const COMMIT: &str = "3837bf0bc02ea5d08f8ee3585fc8c7784a81bce8";
type Replies = Arc<StdMutex<HashMap<String, (u16, Value)>>>;

struct GitHubFixture {
    lookup: ReleaseLookup,
    replies: Replies,
    requests: Arc<StdMutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl GitHubFixture {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut lookup = ReleaseLookup::new().unwrap();
        lookup.upstream = format!("http://{}", listener.local_addr().unwrap());
        lookup.client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(1))
            .build()
            .unwrap();
        let replies = Replies::default();
        let requests = Arc::new(StdMutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (responses, received, stopping) = (replies.clone(), requests.clone(), stop.clone());
        let worker = thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // Accepted sockets can inherit nonblocking mode on macOS.
                        // Only accept() polls; reading an HTTP request must wait for its bytes.
                        stream.set_nonblocking(false).unwrap();
                        stream
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut reader = BufReader::new(&stream);
                        let mut line = String::new();
                        reader.read_line(&mut line).unwrap();
                        let path = line.split_whitespace().nth(1).unwrap().to_owned();
                        loop {
                            line.clear();
                            if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                                break;
                            }
                        }
                        received.lock().unwrap().push(path.clone());
                        let (status, body) = responses
                            .lock()
                            .unwrap()
                            .get(&path)
                            .cloned()
                            .unwrap_or((404, json!({"message":"Not Found"})));
                        let body = body.to_string();
                        write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(1))
                    }
                    Err(error) => panic!("GitHub fixture failed: {error}"),
                }
            }
        });
        Self {
            lookup,
            replies,
            requests,
            stop,
            worker: Some(worker),
        }
    }

    fn reply(&self, path: &str, status: u16, body: Value) {
        self.replies
            .lock()
            .unwrap()
            .insert(format!("/{path}"), (status, body));
    }

    fn release(&self, tag: &str) {
        // GitHub's published_at is the release publication date. target_commitish
        // can be a branch, so verification must use the Git tag object instead.
        self.reply(&format!("releases/tags/{tag}"), 200, json!({
            "tag_name":tag, "draft":false, "published_at":"2026-11-10T16:08:46Z", "target_commitish":"master"
        }));
        self.reply(
            &format!("git/ref/tags/{tag}"),
            200,
            json!({"object":{"type":"commit","sha":COMMIT}}),
        );
    }
}

impl Drop for GitHubFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Err(error) = self.worker.take().unwrap().join() {
            if !thread::panicking() {
                std::panic::resume_unwind(error);
            }
        }
    }
}

fn identity() -> BackendVersion {
    BackendVersion {
        build_number: 12248,
        commit: COMMIT[..9].into(),
        version: "0.9.0-dev".into(),
    }
}

#[tokio::test]
async fn verifies_the_probed_commit_and_coalesces_concurrent_lookups() {
    let fixture = GitHubFixture::new();
    fixture.release("b12248");
    let (first, second) = tokio::join!(
        fixture.lookup.resolve(identity()),
        fixture.lookup.resolve(identity())
    );
    let verified = BackendRelease::Verified {
        date: "2026-11-10".into(),
        tag: "b12248".into(),
    };
    assert_eq!(first.unwrap(), verified);
    assert_eq!(second.unwrap(), verified);
    assert_eq!(
        *fixture.requests.lock().unwrap(),
        ["/releases/tags/b12248", "/git/ref/tags/b12248"]
    );
    assert_eq!(
        serde_json::to_value(verified).unwrap(),
        json!({"status":"verified","date":"2026-11-10","tag":"b12248"})
    );
    let mut different = identity();
    different.commit = "abcdef0".into();
    assert_eq!(
        fixture.lookup.resolve(different).await.unwrap(),
        BackendRelease::CommitMismatch
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), 4);
    fixture
        .lookup
        .cache
        .lock()
        .await
        .get_mut(&identity())
        .unwrap()
        .0 = Instant::now() - CACHE_LIFETIME;
    assert!(matches!(
        fixture.lookup.resolve(identity()).await.unwrap(),
        BackendRelease::Verified { .. }
    ));
    assert_eq!(fixture.requests.lock().unwrap().len(), 6);
}

#[tokio::test]
async fn resolves_semantic_versions_and_annotated_tags() {
    let fixture = GitHubFixture::new();
    fixture.release("v1.0.0");
    let tag_sha = "abcdef0123456789abcdef0123456789abcdef01";
    fixture.reply(
        "git/ref/tags/v1.0.0",
        200,
        json!({"object":{"type":"tag","sha":tag_sha}}),
    );
    fixture.reply(
        &format!("git/tags/{tag_sha}"),
        200,
        json!({"object":{"type":"commit","sha":COMMIT}}),
    );
    let mut version = identity();
    version.version = "1.0.0".into();
    assert_eq!(
        fixture.lookup.resolve(version).await.unwrap(),
        BackendRelease::Verified {
            date: "2026-11-10".into(),
            tag: "v1.0.0".into()
        }
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn reports_absent_releases_and_does_not_request_unidentified_builds() {
    let fixture = GitHubFixture::new();
    assert_eq!(
        fixture.lookup.resolve(identity()).await.unwrap(),
        BackendRelease::NotFound
    );
    let mut unknown = identity();
    unknown.commit = "unknown".into();
    assert_eq!(
        fixture.lookup.resolve(unknown).await.unwrap(),
        BackendRelease::Unidentified
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn network_and_metadata_failures_are_retryable() {
    let fixture = GitHubFixture::new();
    fixture.reply(
        "releases/tags/b12248",
        403,
        json!({"message":"API rate limit exceeded"}),
    );
    assert!(fixture
        .lookup
        .resolve(identity())
        .await
        .unwrap_err()
        .contains("HTTP 403"));
    fixture.reply(
        "releases/tags/b12248",
        200,
        json!({"tag_name":"b12248","draft":false,"published_at":"2026-02-30T16:08:46Z"}),
    );
    assert!(fixture
        .lookup
        .resolve(identity())
        .await
        .unwrap_err()
        .contains("invalid release date"));
    fixture.release("b12248");
    assert!(matches!(
        fixture.lookup.resolve(identity()).await.unwrap(),
        BackendRelease::Verified { .. }
    ));
}

#[tokio::test]
async fn connection_failure_reports_an_error_without_inventing_a_date() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let mut lookup = ReleaseLookup::new().unwrap();
    lookup.upstream = endpoint;
    lookup.client = Client::builder().no_proxy().build().unwrap();
    assert!(lookup
        .resolve(identity())
        .await
        .unwrap_err()
        .contains("Cannot reach GitHub"));
}

#[test]
fn validates_dates_without_using_build_times_or_file_timestamps() {
    assert_eq!(release_date("2024-02-29T23:59:59Z"), Some("2024-02-29"));
    for invalid in [
        "2026-02-29T00:00:00Z",
        "2026-13-10T00:00:00Z",
        "2026-11-10T24:00:00Z",
        "2026-11-10",
        "not a date",
    ] {
        assert_eq!(release_date(invalid), None);
    }
}

#[tokio::test]
async fn runtime_looks_up_the_identity_discovered_from_the_selected_executable() {
    use crate::configuration::environment::Environment;
    use std::{collections::BTreeMap, fs, os::unix::fs::PermissionsExt};

    let mut fixture = GitHubFixture::new();
    fixture.release("b42");
    fixture.reply(
        "git/ref/tags/b42",
        200,
        json!({"object":{
            "type":"commit", "sha":format!("abc1234{}", "0".repeat(33))
        }}),
    );
    let work = tempfile::tempdir().unwrap();
    let bin = work.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let server = bin.join("llama-server");
    fs::write(&server, include_bytes!("../../../tests/fixtures/server.py")).unwrap();
    fs::set_permissions(server, fs::Permissions::from_mode(0o755)).unwrap();
    let environment = Environment::from_variables(
        BTreeMap::from([
            ("HOME".into(), work.path().as_os_str().to_owned()),
            (
                "STRAGGLER_LLAMA_CPP_DIR".into(),
                work.path().as_os_str().to_owned(),
            ),
        ]),
        None,
    )
    .unwrap();
    let mut runtime = Runtime::new(environment, work.path().join("data")).unwrap();
    runtime.backend_releases =
        std::mem::replace(&mut fixture.lookup, ReleaseLookup::new().unwrap());
    let configuration = runtime.inspect().unwrap();
    assert_eq!(configuration.build["commit"], "abc1234");
    assert_eq!(
        runtime.backend_release().await.unwrap(),
        BackendRelease::Verified {
            date: "2026-11-10".into(),
            tag: "b42".into()
        }
    );
    assert_eq!(
        *fixture.requests.lock().unwrap(),
        ["/releases/tags/b42", "/git/ref/tags/b42"]
    );
    runtime.shutdown().unwrap();
}
