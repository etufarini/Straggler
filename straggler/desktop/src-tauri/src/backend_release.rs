use crate::{configuration::version::BackendVersion, Result, Runtime};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const UPSTREAM: &str = "https://api.github.com/repos/ggml-org/llama.cpp";
const CACHE_LIFETIME: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BackendRelease {
    Verified { date: String, tag: String },
    NotFound,
    CommitMismatch,
    Unidentified,
}

pub(crate) struct ReleaseLookup {
    client: Client,
    upstream: String,
    cache: Mutex<HashMap<BackendVersion, (Instant, BackendRelease)>>,
}

impl ReleaseLookup {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: Client::builder()
                .user_agent("Straggler")
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(5))
                .build()
                .map_err(|error| error.to_string())?,
            upstream: UPSTREAM.into(),
            cache: Mutex::new(HashMap::new()),
        })
    }

    async fn resolve(&self, identity: BackendVersion) -> Result<BackendRelease> {
        if !hex_commit(&identity.commit, 7) {
            return Ok(BackendRelease::Unidentified);
        }
        tokio::time::timeout(Duration::from_secs(8), self.resolve_cached(identity))
            .await
            .map_err(|_| {
                "GitHub release lookup timed out. Check your connection and retry.".to_owned()
            })?
    }

    async fn resolve_cached(&self, identity: BackendVersion) -> Result<BackendRelease> {
        // This lock coalesces concurrent Settings mounts, including React StrictMode.
        // It is independent of configuration, server controls and inference requests.
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (checked, _)| checked.elapsed() < CACHE_LIFETIME);
        if let Some((_, release)) = cache.get(&identity) {
            return Ok(release.clone());
        }
        let release = self.lookup(&identity).await?;
        cache.insert(identity, (Instant::now(), release.clone()));
        Ok(release)
    }

    async fn lookup(&self, identity: &BackendVersion) -> Result<BackendRelease> {
        let mut candidates = vec![format!("b{}", identity.build_number)];
        let components: Vec<_> = identity.version.split('.').collect();
        if components.len() == 3
            && components
                .iter()
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        {
            candidates.push(format!("v{}", identity.version));
        }
        let mut mismatch = false;
        for tag in candidates {
            let Some(release) = self.get::<Release>(&format!("releases/tags/{tag}")).await? else {
                continue;
            };
            if release.draft || release.tag_name != tag {
                return Err("GitHub returned inconsistent release metadata.".into());
            }
            let Some(published) = release.published_at else {
                continue;
            };
            let date =
                release_date(&published).ok_or("GitHub returned an invalid release date.")?;
            let Some(reference) = self
                .get::<Reference>(&format!("git/ref/tags/{tag}"))
                .await?
            else {
                return Err(
                    "The release tag could not be verified on GitHub. Retry the lookup.".into(),
                );
            };
            let mut object = reference.object;
            // Annotated tags can point to another tag. Resolve a bounded chain to its commit.
            for _ in 0..4 {
                if object.kind != "tag" {
                    break;
                }
                if !hex_commit(&object.sha, 40) {
                    return Err("GitHub returned an invalid tag identity.".into());
                }
                object = self
                    .get::<Reference>(&format!("git/tags/{}", object.sha))
                    .await?
                    .ok_or("The annotated release tag is unavailable on GitHub.")?
                    .object;
            }
            if object.kind != "commit" || !hex_commit(&object.sha, 40) {
                return Err("GitHub did not resolve the release tag to a commit.".into());
            }
            if object
                .sha
                .to_ascii_lowercase()
                .starts_with(&identity.commit.to_ascii_lowercase())
            {
                return Ok(BackendRelease::Verified {
                    date: date.into(),
                    tag,
                });
            }
            mismatch = true;
        }
        Ok(if mismatch {
            BackendRelease::CommitMismatch
        } else {
            BackendRelease::NotFound
        })
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<Option<T>> {
        let response = self
            .client
            .get(format!("{}/{path}", self.upstream))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|error| format!("Cannot reach GitHub to read the release date: {error}"))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!("GitHub release lookup failed (HTTP {}). Check your connection or API rate limit and retry.", response.status().as_u16()));
        }
        response
            .json()
            .await
            .map(Some)
            .map_err(|error| format!("GitHub returned invalid release metadata: {error}"))
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    published_at: Option<String>,
    draft: bool,
}

#[derive(Deserialize)]
struct Reference {
    object: GitObject,
}

#[derive(Deserialize)]
struct GitObject {
    #[serde(rename = "type")]
    kind: String,
    sha: String,
}

fn hex_commit(value: &str, minimum: usize) -> bool {
    (minimum..=40).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn release_date(timestamp: &str) -> Option<&str> {
    if timestamp.len() != 20 || !timestamp.is_ascii() {
        return None;
    }
    for (index, byte) in timestamp.bytes().enumerate() {
        let valid = match index {
            4 | 7 => byte == b'-',
            10 => byte == b'T',
            13 | 16 => byte == b':',
            19 => byte == b'Z',
            _ => byte.is_ascii_digit(),
        };
        if !valid {
            return None;
        }
    }
    let year: u32 = timestamp[..4].parse().ok()?;
    let month: u32 = timestamp[5..7].parse().ok()?;
    let day: u32 = timestamp[8..10].parse().ok()?;
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => return None,
    };
    if year == 0
        || !(1..=days).contains(&day)
        || timestamp[11..13].parse::<u32>().ok()? > 23
        || timestamp[14..16].parse::<u32>().ok()? > 59
        || timestamp[17..19].parse::<u32>().ok()? > 59
    {
        return None;
    }
    Some(&timestamp[..10])
}

impl Runtime {
    pub async fn backend_release(&self) -> Result<BackendRelease> {
        // Trust the native probe, never a path or commit supplied by the frontend.
        let identity = {
            let workspace = self.workspace.lock().map_err(|error| error.to_string())?;
            let configuration = workspace
                .configuration
                .as_ref()
                .ok_or("Backend configuration is unavailable.")?;
            let build = &configuration.build;
            match (
                configuration.llama_dir.is_empty(),
                build["buildNumber"].as_u64(),
                build["commit"].as_str(),
                build["version"].as_str(),
            ) {
                (false, Some(build_number), Some(commit), Some(version)) => BackendVersion {
                    build_number,
                    commit: commit.into(),
                    version: version.into(),
                },
                _ => return Ok(BackendRelease::Unidentified),
            }
        };
        self.backend_releases.resolve(identity).await
    }
}

#[cfg(test)]
mod tests;
