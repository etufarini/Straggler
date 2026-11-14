use super::api::{
    valid_sha256, validate_remote_path, validate_repository, HubClient, RemoteFile, Repository,
};
use super::catalog::file_group;
use crate::{files::write_atomic, platform::available_disk_bytes, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadPlan {
    pub repository: String,
    pub revision: String,
    pub files: Vec<RemoteFile>,
}

impl DownloadPlan {
    pub fn selected(repository: &Repository, selected: &[String]) -> Result<Self> {
        if selected.is_empty() || selected.len() > 2 {
            return Err("Choose a GGUF model and, optionally, a projector file.".into());
        }
        let mut paths = BTreeSet::new();
        for selected in selected {
            for file in file_group(&repository.files, selected)? {
                paths.insert(file.path.clone());
            }
        }
        let files = repository
            .files
            .iter()
            .filter(|file| paths.contains(&file.path))
            .cloned()
            .collect();
        let plan = Self {
            repository: repository.id.clone(),
            revision: repository.revision.clone(),
            files,
        };
        plan.validate()?;
        Ok(plan)
    }

    fn validate(&self) -> Result<()> {
        validate_repository(&self.repository)?;
        if self.revision.len() != 40
            || !self.revision.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.files.is_empty()
            || self.files.len() > 1024
        {
            return Err("The download plan has no valid pinned revision or file group.".into());
        }
        let mut names = BTreeSet::new();
        for file in &self.files {
            validate_remote_path(&file.path)?;
            if !file.path.to_ascii_lowercase().ends_with(".gguf")
                || !names.insert(file_name(file).to_owned())
            {
                return Err(
                    "The download contains duplicate or unsupported destination file names.".into(),
                );
            }
            if !file.sha256.as_deref().is_some_and(valid_sha256) {
                return Err("The repository does not report SHA-256 for every selected file. These files cannot be verified.".into());
            }
        }
        self.total()?;
        Ok(())
    }

    pub fn total(&self) -> Result<u64> {
        self.files.iter().try_fold(0u64, |sum, file| {
            sum.checked_add(file.size)
                .ok_or_else(|| "The download size is too large.".into())
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Download {
    pub id: Uuid,
    pub plan: DownloadPlan,
    pub root: PathBuf,
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub error: Option<String>,
}

struct Job {
    record: Download,
    token: CancellationToken,
    cancel: bool,
}
struct Jobs {
    values: BTreeMap<Uuid, Job>,
    load_error: Option<String>,
}
pub struct Downloads {
    ledger: PathBuf,
    jobs: Mutex<Jobs>,
}

impl Downloads {
    pub fn new(directory: &Path) -> Self {
        let ledger = directory.join("downloads.json");
        let loaded = (|| -> Result<BTreeMap<Uuid, Job>> {
            let file = match fs::File::open(&ledger) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(BTreeMap::new())
                }
                Err(error) => return Err(format!("Cannot read download state: {error}")),
            };
            let mut bytes = Vec::new();
            file.take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("Cannot read download state: {error}"))?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err("Download state exceeds the size limit.".into());
            }
            let records: Vec<Download> = serde_json::from_slice(&bytes)
                .map_err(|_| "Download state is invalid. The original file was kept.")?;
            let mut values = BTreeMap::new();
            for mut record in records {
                record.plan.validate()?;
                if !record.root.is_absolute()
                    || record.total != record.plan.total()?
                    || values.contains_key(&record.id)
                {
                    return Err("Invalid saved download destination or identity.".into());
                }
                if !matches!(record.phase.as_str(), "completed" | "cancelled") {
                    record.phase = "paused".into();
                }
                values.insert(
                    record.id,
                    Job {
                        record,
                        token: CancellationToken::new(),
                        cancel: false,
                    },
                );
            }
            Ok(values)
        })();
        let (values, load_error) = match loaded {
            Ok(values) => (values, None),
            Err(error) => (BTreeMap::new(), Some(error)),
        };
        Self {
            ledger,
            jobs: Mutex::new(Jobs { values, load_error }),
        }
    }

    fn persist(&self, jobs: &Jobs) -> Result<()> {
        let directory = self
            .ledger
            .parent()
            .ok_or("Download storage has no parent.")?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("Cannot create download storage: {error}"))?;
        let records: Vec<_> = jobs.values.values().map(|job| &job.record).collect();
        write_atomic(
            &self.ledger,
            &serde_json::to_vec(&records).map_err(|e| e.to_string())?,
        )
    }

    pub fn list(&self) -> Result<Vec<Download>> {
        let jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &jobs.load_error {
            return Err(error.clone());
        }
        Ok(jobs.values.values().map(|job| job.record.clone()).collect())
    }

    pub fn is_active(&self) -> Result<bool> {
        Ok(self
            .jobs
            .lock()
            .map_err(|e| e.to_string())?
            .values
            .values()
            .any(|job| active(&job.record.phase)))
    }

    pub fn start(
        self: &Arc<Self>,
        plan: DownloadPlan,
        root: PathBuf,
        hub: HubClient,
    ) -> Result<Uuid> {
        plan.validate()?;
        let root = root
            .canonicalize()
            .map_err(|_| "Choose a readable models folder before downloading.")?;
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        if let Some(error) = &jobs.load_error {
            return Err(error.clone());
        }
        if jobs.values.values().any(|job| active(&job.record.phase)) {
            return Err("Pause the current download before starting another.".into());
        }
        if jobs.values.values().any(|job| {
            job.record.root == root
                && !matches!(job.record.phase.as_str(), "completed" | "cancelled")
                && job.record.plan.repository == plan.repository
                && job.record.plan.files.iter().any(|existing| {
                    plan.files
                        .iter()
                        .any(|file| file_name(file) == file_name(existing))
                })
        }) {
            return Err("Resume or cancel the existing download for these files.".into());
        }
        let id = Uuid::new_v4();
        let record = Download {
            id,
            total: plan.total()?,
            plan,
            root,
            phase: "downloading".into(),
            downloaded: 0,
            error: None,
        };
        let directory = destination_directory(&record, false)?;
        for file in &record.plan.files {
            owns_partial(&record, file, &part_path(&directory, file))?;
        }
        let token = CancellationToken::new();
        jobs.values.insert(
            id,
            Job {
                record: record.clone(),
                token: token.clone(),
                cancel: false,
            },
        );
        if let Err(error) = self.persist(&jobs) {
            jobs.values.remove(&id);
            return Err(error);
        }
        drop(jobs);
        self.spawn(record, token, hub);
        Ok(id)
    }

    pub fn resume(self: &Arc<Self>, id: Uuid, root: &Path, hub: HubClient) -> Result<()> {
        let root = root
            .canonicalize()
            .map_err(|_| "The models folder is unavailable.")?;
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        if jobs.values.values().any(|job| active(&job.record.phase)) {
            return Err("Pause the current download first.".into());
        }
        let job = jobs
            .values
            .get_mut(&id)
            .ok_or("This download is unavailable.")?;
        if job.record.root != root {
            return Err("Choose this download's original models folder before resuming.".into());
        }
        if !matches!(job.record.phase.as_str(), "paused" | "error") {
            return Err("This download cannot be resumed.".into());
        }
        job.record.plan.validate()?;
        let previous = job.record.clone();
        job.record.phase = "downloading".into();
        job.record.error = None;
        job.token = CancellationToken::new();
        job.cancel = false;
        let record = job.record.clone();
        let token = job.token.clone();
        if let Err(error) = self.persist(&jobs) {
            jobs.values.get_mut(&id).unwrap().record = previous;
            return Err(error);
        }
        drop(jobs);
        self.spawn(record, token, hub);
        Ok(())
    }

    pub fn control(&self, id: Uuid, cancel: bool) -> Result<()> {
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs
            .values
            .get_mut(&id)
            .ok_or("This download is unavailable.")?;
        if matches!(job.record.phase.as_str(), "completed" | "cancelled") {
            return Ok(());
        }
        if active(&job.record.phase) {
            job.cancel = cancel;
            job.record.phase = if cancel { "cancelling" } else { "pausing" }.into();
            job.token.cancel();
        } else if cancel {
            cleanup_parts(&job.record)?;
            job.record.phase = "cancelled".into();
        }
        self.persist(&jobs)
    }

    pub fn pause_all(&self) -> Result<()> {
        let ids: Vec<_> = self
            .jobs
            .lock()
            .map_err(|e| e.to_string())?
            .values
            .values()
            .filter(|job| active(&job.record.phase))
            .map(|job| job.record.id)
            .collect();
        for id in ids {
            self.control(id, false)?;
        }
        Ok(())
    }

    fn progress(&self, id: Uuid, downloaded: u64, phase: &str) -> Result<()> {
        let mut jobs = self.jobs.lock().map_err(|e| e.to_string())?;
        let job = jobs
            .values
            .get_mut(&id)
            .ok_or("This download is unavailable.")?;
        job.record.downloaded = downloaded;
        if !job.token.is_cancelled() {
            job.record.phase = phase.into();
        }
        Ok(())
    }

    fn spawn(self: &Arc<Self>, record: Download, token: CancellationToken, hub: HubClient) {
        let manager = self.clone();
        tokio::spawn(async move {
            let result = manager.transfer(&record, &token, &hub).await;
            let Ok(mut jobs) = manager.jobs.lock() else {
                return;
            };
            let Some(job) = jobs.values.get_mut(&record.id) else {
                return;
            };
            if result.is_ok() {
                job.record.phase = "completed".into();
                job.record.downloaded = job.record.total;
            } else if token.is_cancelled() {
                if job.cancel {
                    match cleanup_parts(&record) {
                        Ok(()) => job.record.phase = "cancelled".into(),
                        Err(error) => {
                            job.record.phase = "error".into();
                            job.record.error = Some(error);
                        }
                    }
                } else {
                    job.record.phase = "paused".into();
                }
            } else {
                job.record.phase = "error".into();
                job.record.error = result.err();
            }
            if let Err(error) = manager.persist(&jobs) {
                if let Some(job) = jobs.values.get_mut(&record.id) {
                    job.record.error = Some(format!("Download state could not be saved: {error}"));
                }
            }
        });
    }

    async fn transfer(
        &self,
        record: &Download,
        token: &CancellationToken,
        hub: &HubClient,
    ) -> Result<()> {
        let directory = destination_directory(record, true)?;
        let mut remaining = 0u64;
        for file in &record.plan.files {
            let final_path = directory.join(file_name(file));
            if final_path.exists() {
                continue;
            }
            let partial = part_path(&directory, file);
            let size = fs::symlink_metadata(partial)
                .map(|metadata| metadata.len().min(file.size))
                .unwrap_or(0);
            remaining = remaining
                .checked_add(file.size - size)
                .ok_or("The download size is too large.")?;
        }
        if available_disk_bytes(&directory)? < remaining {
            return Err(
                "There is not enough disk space for this download. Free space and resume.".into(),
            );
        }
        let mut done = 0;
        for file in &record.plan.files {
            if token.is_cancelled() {
                return Err("Download paused.".into());
            }
            let final_path = directory.join(file_name(file));
            if final_path.exists() {
                if !fs::symlink_metadata(&final_path)
                    .map_err(|e| e.to_string())?
                    .is_file()
                    || hash_file(&final_path, token)? != file.sha256.as_deref().unwrap()
                {
                    return Err(
                        "A different file already exists at the download destination. It was kept."
                            .into(),
                    );
                }
                done += file.size;
                continue;
            }
            let partial_path = part_path(&directory, file);
            let metadata_path = partial_path.with_extension("part.json");
            if !owns_partial(record, file, &partial_path)? {
                write_atomic(&metadata_path, &partial_identity(record, file)?)?;
            }
            let mut partial = OpenOptions::new().read(true).write(true).create(true).truncate(false)
                .custom_flags(libc::O_NOFOLLOW).open(&partial_path).map_err(|error| format!("Cannot write the models folder. Re-select it if its permission expired: {error}"))?;
            let mut offset = partial.metadata().map_err(|e| e.to_string())?.len();
            if offset > file.size {
                return Err(
                    "The partial file is larger than the selected version. Cancel it and retry."
                        .into(),
                );
            }
            if offset < file.size {
                let response = tokio::select! {
                    _ = token.cancelled() => return Err("Download paused.".into()),
                    response = hub.download_response(&record.plan.repository, &record.plan.revision, &file.path, offset) => response?,
                };
                if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    validate_range(
                        response
                            .headers()
                            .get(reqwest::header::CONTENT_RANGE)
                            .and_then(|value| value.to_str().ok()),
                        offset,
                        file.size,
                    )?;
                } else if offset > 0 {
                    // A server may ignore Range. Restart this part rather than append duplicate bytes.
                    partial.set_len(0).map_err(|e| e.to_string())?;
                    offset = 0;
                }
                partial
                    .seek(SeekFrom::Start(offset))
                    .map_err(|e| e.to_string())?;
                self.progress(record.id, done + offset, "downloading")?;
                let mut stream = response.bytes_stream();
                loop {
                    let chunk = tokio::select! {
                        _ = token.cancelled() => return Err("Download paused.".into()),
                        next = tokio::time::timeout(Duration::from_secs(30), stream.next()) => next.map_err(|_| "The download stalled. Resume to try again.")?,
                    };
                    let Some(chunk) = chunk else {
                        break;
                    };
                    let chunk =
                        chunk.map_err(|_| "The download was interrupted. Resume to try again.")?;
                    if chunk.len() as u64 > file.size - offset {
                        return Err(
                            "The server sent more bytes than the selected file size.".into()
                        );
                    }
                    partial
                        .write_all(&chunk)
                        .map_err(|error| format!("Cannot write the partial download: {error}"))?;
                    offset += chunk.len() as u64;
                    self.progress(record.id, done + offset, "downloading")?;
                }
            }
            partial.sync_all().map_err(|e| e.to_string())?;
            drop(partial);
            if offset != file.size {
                return Err(
                    "The file is incomplete. Resume to download the remaining bytes.".into(),
                );
            }
            self.progress(record.id, done + offset, "verifying")?;
            if hash_file(&partial_path, token)? != file.sha256.as_deref().unwrap() {
                fs::remove_file(&partial_path).map_err(|e| e.to_string())?;
                fs::remove_file(&metadata_path).map_err(|e| e.to_string())?;
                return Err("SHA-256 verification failed. The corrupt partial file was removed; resume to retry.".into());
            }
            done += file.size;
        }
        let mut published = Vec::new();
        for file in &record.plan.files {
            if token.is_cancelled() {
                for path in published {
                    let _ = fs::remove_file(path);
                }
                return Err("Download paused.".into());
            }
            let destination = directory.join(file_name(file));
            if destination.exists() {
                continue;
            }
            if let Err(error) = fs::hard_link(part_path(&directory, file), &destination) {
                for path in published {
                    let _ = fs::remove_file(path);
                }
                return Err(format!("Cannot activate the verified model files: {error}"));
            }
            published.push(destination);
        }
        cleanup_parts(record)?;
        Ok(())
    }
}

fn active(phase: &str) -> bool {
    matches!(
        phase,
        "downloading" | "verifying" | "pausing" | "cancelling"
    )
}
fn file_name(file: &RemoteFile) -> &str {
    file.path.rsplit('/').next().unwrap_or("")
}
fn part_path(directory: &Path, file: &RemoteFile) -> PathBuf {
    directory.join(format!("{}.part", file_name(file)))
}

fn destination_directory(record: &Download, create: bool) -> Result<PathBuf> {
    let (owner, repository) = validate_repository(&record.plan.repository)?;
    let mut directory = record.root.clone();
    for component in [owner, repository] {
        directory.push(component);
        if let Ok(metadata) = fs::symlink_metadata(&directory) {
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("A download directory is a link or a non-directory. Choose another models folder.".into());
            }
        } else if create {
            fs::create_dir(&directory).map_err(|error| format!("Cannot create the model directory. Re-select the folder if its permission expired: {error}"))?;
        }
    }
    Ok(directory)
}

fn cleanup_parts(record: &Download) -> Result<()> {
    let directory = destination_directory(record, false)?;
    for file in &record.plan.files {
        let partial = part_path(&directory, file);
        if !owns_partial(record, file, &partial)? {
            continue;
        }
        for path in [&partial, &partial.with_extension("part.json")] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("Cannot remove the partial download: {error}")),
            }
        }
    }
    Ok(())
}

fn partial_identity(record: &Download, file: &RemoteFile) -> Result<Vec<u8>> {
    serde_json::to_vec(&(&record.plan.repository, &record.plan.revision, file))
        .map_err(|e| e.to_string())
}

fn owns_partial(record: &Download, file: &RemoteFile, partial: &Path) -> Result<bool> {
    let metadata = partial.with_extension("part.json");
    let source = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(metadata);
    let source = match source {
        Ok(source) => source,
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                && fs::symlink_metadata(partial).is_err() =>
        {
            return Ok(false)
        }
        Err(_) => {
            return Err(
                "An existing partial file has no readable download identity. It was kept.".into(),
            )
        }
    };
    let mut bytes = Vec::new();
    source
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes != partial_identity(record, file)? {
        return Err(
            "An existing partial download belongs to another revision. It was kept.".into(),
        );
    }
    Ok(true)
}

fn hash_file(path: &Path, token: &CancellationToken) -> Result<String> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        if token.is_cancelled() {
            return Err("Download paused.".into());
        }
        let length = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn validate_range(value: Option<&str>, offset: u64, total: u64) -> Result<()> {
    let valid = value
        .and_then(|value| value.strip_prefix("bytes "))
        .and_then(|value| value.split_once('/'))
        .and_then(|(range, length)| {
            range
                .split_once('-')
                .map(|(start, end)| (start, end, length))
        })
        .is_some_and(|(start, end, length)| {
            start.parse::<u64>() == Ok(offset)
                && length.parse::<u64>() == Ok(total)
                && end
                    .parse::<u64>()
                    .is_ok_and(|end| end >= offset && end < total)
        });
    if valid {
        Ok(())
    } else {
        Err("The server returned an invalid resume range. The partial file was kept.".into())
    }
}
