use super::{
    catalog::{self, Variant},
    credentials::TokenStore,
};
use crate::Result;
use futures_util::StreamExt;
use reqwest::{header, Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{sync::Arc, time::Duration};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteFile {
    pub path: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub revision: String,
    pub files: Vec<RemoteFile>,
    pub variants: Vec<Variant>,
    pub gated: bool,
    pub warning: Option<String>,
    pub suggested_file: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySummary {
    pub id: String,
    pub downloads: u64,
    pub gated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub repositories: Vec<RepositorySummary>,
    pub direct: Option<Repository>,
    pub warning: Option<String>,
}

#[derive(Clone)]
pub struct HubClient {
    pub(crate) client: Client,
    pub(crate) base: Url,
    pub(crate) tokens: Arc<dyn TokenStore>,
}

impl HubClient {
    pub fn new(tokens: Arc<dyn TokenStore>) -> Result<Self> {
        Self::with_base(tokens, Url::parse("https://huggingface.co/").unwrap())
    }

    fn with_base(tokens: Arc<dyn TokenStore>, base: Url) -> Result<Self> {
        let builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .user_agent("Straggler desktop");
        let builder = if base.scheme() == "http" {
            builder.no_proxy()
        } else {
            builder
        };
        let client = builder
            .build()
            .map_err(|_| "Cannot prepare the Hugging Face HTTPS client.")?;
        Ok(Self {
            client,
            base,
            tokens,
        })
    }

    #[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
    pub fn loopback_fixture(tokens: Arc<dyn TokenStore>, endpoint: &str) -> Result<Self> {
        let base = Url::parse(endpoint).map_err(|_| "Invalid fixture endpoint.")?;
        if base.scheme() != "http" || base.host_str() != Some("127.0.0.1") {
            return Err("HF fixtures must use IPv4 loopback HTTP.".into());
        }
        Self::with_base(tokens, base)
    }

    pub(crate) fn url(&self, segments: &[&str]) -> Result<Url> {
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| "Invalid Hub endpoint.")?
            .extend(segments);
        Ok(url)
    }

    async fn token(&self) -> (Option<String>, Option<String>) {
        let store = self.tokens.clone();
        match tokio::task::spawn_blocking(move || store.read()).await {
            Ok(Ok(token)) => (token, None),
            _ => (
                None,
                Some("The system keychain is unavailable. This request uses public access.".into()),
            ),
        }
    }

    async fn get(&self, url: Url, token: Option<&str>) -> Result<Response> {
        let mut request = self.client.get(url).timeout(Duration::from_secs(30));
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Cannot connect to Hugging Face. Check the connection and retry.")?;
        match response.status().as_u16() {
            200 => Ok(response),
            401 | 403 => Err("Access restricted. Add a read token and accept the repository's license or request access on Hugging Face, then retry.".into()),
            404 => Err("This repository or revision was not found, or your token cannot access it.".into()),
            429 => Err("Hugging Face has limited requests. Wait and try again.".into()),
            code => Err(format!("Hugging Face returned HTTP {code}. Try again later.")),
        }
    }

    pub async fn search(&self, query: &str) -> Result<SearchResults> {
        let query = query.trim();
        if query.is_empty() || query.len() > 4096 {
            return Err("Enter a model name, repository or Hugging Face link.".into());
        }
        if let Some(input) = repository_input(query)? {
            let direct = self
                .repository(&input.id, &input.revision, input.file)
                .await?;
            return Ok(SearchResults {
                repositories: Vec::new(),
                warning: direct.warning.clone(),
                direct: Some(direct),
            });
        }
        let (token, warning) = self.token().await;
        let mut url = self.url(&["api", "models"])?;
        url.query_pairs_mut().extend_pairs([
            ("search", query),
            ("filter", "gguf"),
            ("sort", "downloads"),
            ("direction", "-1"),
            ("limit", "30"),
        ]);
        let data = read_json(self.get(url, token.as_deref()).await?).await?;
        let rows = data
            .as_array()
            .ok_or("Hugging Face returned an invalid search result.")?;
        let repositories = rows
            .iter()
            .filter_map(|row| {
                let id = row["id"].as_str()?;
                validate_repository(id).ok()?;
                Some(RepositorySummary {
                    id: id.into(),
                    downloads: row["downloads"].as_u64().unwrap_or(0),
                    gated: is_gated(&row["gated"]),
                })
            })
            .collect();
        Ok(SearchResults {
            repositories,
            direct: None,
            warning,
        })
    }

    pub async fn repository(
        &self,
        id: &str,
        revision: &str,
        suggested_file: Option<String>,
    ) -> Result<Repository> {
        let (owner, name) = validate_repository(id)?;
        if revision.is_empty() || revision.len() > 200 || revision.chars().any(char::is_control) {
            return Err("Invalid Hugging Face revision.".into());
        }
        let (token, warning) = self.token().await;
        let info = read_json(
            self.get(
                self.url(&["api", "models", owner, name, "revision", revision])?,
                token.as_deref(),
            )
            .await?,
        )
        .await?;
        let commit = info["sha"]
            .as_str()
            .filter(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or("The repository did not report a pinned commit.")?
            .to_owned();
        let initial = self.url(&["api", "models", owner, name, "tree", &commit])?;
        let mut next = initial.clone();
        next.query_pairs_mut()
            .extend_pairs([("recursive", "true"), ("expand", "false")]);
        let mut files = Vec::new();
        for page in 0..100 {
            let response = self.get(next.clone(), token.as_deref()).await?;
            let following = next_page(&response)?;
            let rows = read_json(response).await?;
            for row in rows
                .as_array()
                .ok_or("The repository returned an invalid file list.")?
            {
                if row["type"] != "file" {
                    continue;
                }
                let Some(path) = row["path"]
                    .as_str()
                    .filter(|path| path.to_ascii_lowercase().ends_with(".gguf"))
                else {
                    continue;
                };
                validate_remote_path(path)?;
                let size = row["size"]
                    .as_u64()
                    .ok_or("A GGUF file has no reported size.")?;
                let sha256 = row["lfs"]["oid"]
                    .as_str()
                    .filter(|hash| valid_sha256(hash))
                    .map(str::to_ascii_lowercase);
                files.push(RemoteFile {
                    path: path.into(),
                    size,
                    sha256,
                });
                if files.len() > 20_000 {
                    return Err("This repository has too many GGUF files to list.".into());
                }
            }
            match following {
                None => break,
                Some(url)
                    if page < 99
                        && url.origin() == self.base.origin()
                        && url.path() == initial.path() =>
                {
                    next = url
                }
                _ => return Err("The repository returned an unsupported pagination link.".into()),
            }
        }
        files.sort_by(|left, right| left.path.cmp(&right.path));
        files.dedup_by(|left, right| left.path == right.path);
        let variants = catalog::variants(&files);
        let suggested_file = suggested_file.and_then(|path| {
            catalog::file_group(&files, &path)
                .ok()
                .and_then(|files| files.first().map(|file| file.path.clone()))
        });
        Ok(Repository {
            id: id.into(),
            revision: commit,
            files,
            variants,
            gated: is_gated(&info["gated"]),
            warning,
            suggested_file,
        })
    }

    pub(crate) async fn download_response(
        &self,
        id: &str,
        revision: &str,
        path: &str,
        offset: u64,
    ) -> Result<Response> {
        let (owner, name) = validate_repository(id)?;
        validate_remote_path(path)?;
        let mut parts = vec![owner, name, "resolve", revision];
        parts.extend(path.split('/'));
        let mut url = self.url(&parts)?;
        let (token, _) = self.token().await;
        for _ in 0..8 {
            let mut request = self.client.get(url.clone());
            if offset > 0 {
                request = request.header(header::RANGE, format!("bytes={offset}-"));
            }
            if url.origin() == self.base.origin() {
                if let Some(token) = &token {
                    request = request.bearer_auth(token);
                }
            }
            let response = request
                .send()
                .await
                .map_err(|_| "The download connection failed. Resume to try again.")?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or("The download redirect has no location.")?;
                let next = url
                    .join(location)
                    .map_err(|_| "Invalid download redirect.")?;
                let allowed = next.scheme() == "https"
                    && next.host_str().is_some_and(|host| {
                        host == "huggingface.co"
                            || host.ends_with(".huggingface.co")
                            || host.ends_with(".hf.co")
                    });
                if (!allowed && next.origin() != self.base.origin())
                    || !next.username().is_empty()
                    || next.password().is_some()
                {
                    return Err("Hugging Face redirected to an unsupported download host.".into());
                }
                url = next;
                continue;
            }
            return match response.status().as_u16() {
                200 | 206 => Ok(response),
                401 | 403 => Err("Download access is restricted. Accept the repository license and add an authorized read token, then resume.".into()),
                code => Err(format!("Download failed (HTTP {code}). Resume to try again.")),
            };
        }
        Err("Too many Hugging Face download redirects.".into())
    }
}

pub fn validate_repository(id: &str) -> Result<(&str, &str)> {
    let (owner, name) = id
        .split_once('/')
        .ok_or("Use publisher/repository or a Hugging Face repository link.")?;
    for part in [owner, name] {
        if part.is_empty()
            || part.len() > 96
            || part == "."
            || part == ".."
            || !part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        {
            return Err("Invalid Hugging Face repository identifier.".into());
        }
    }
    Ok((owner, name))
}

pub fn validate_remote_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.len() > 4096
        || path.contains(['\\', '\0'])
        || path.chars().any(char::is_control)
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("The repository contains an unsafe file path.".into());
    }
    Ok(())
}

pub fn valid_sha256(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn is_gated(value: &Value) -> bool {
    value == true
        || value
            .as_str()
            .is_some_and(|gate| gate != "false" && !gate.is_empty())
}

async fn read_json(response: Response) -> Result<Value> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Hugging Face interrupted its response.")?;
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("The Hugging Face response exceeds the size limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "Hugging Face returned invalid JSON.".into())
}

fn next_page(response: &Response) -> Result<Option<Url>> {
    let Some(link) = response.headers().get(header::LINK) else {
        return Ok(None);
    };
    let link = link
        .to_str()
        .map_err(|_| "Invalid repository pagination.")?;
    for part in link.split(',') {
        if part.contains("rel=\"next\"") {
            let url = part
                .trim()
                .strip_prefix('<')
                .and_then(|part| part.split_once('>').map(|(url, _)| url))
                .ok_or("Invalid repository pagination.")?;
            return Url::parse(url)
                .map(Some)
                .map_err(|_| "Invalid repository pagination.".into());
        }
    }
    Ok(None)
}

struct RepositoryInput {
    id: String,
    revision: String,
    file: Option<String>,
}
fn repository_input(query: &str) -> Result<Option<RepositoryInput>> {
    if query.contains("://") {
        let url = Url::parse(query).map_err(|_| "Enter a valid Hugging Face link.")?;
        if url.scheme() != "https"
            || url.host_str() != Some("huggingface.co")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Paste an HTTPS repository link from huggingface.co.".into());
        }
        let decoded = url
            .path()
            .trim_matches('/')
            .split('/')
            .map(decode_segment)
            .collect::<Result<Vec<_>>>()?;
        let parts: Vec<_> = decoded.iter().map(String::as_str).collect();
        if parts.len() < 2 {
            return Err("The link must identify a publisher and repository.".into());
        }
        let id = format!("{}/{}", parts[0], parts[1]);
        validate_repository(&id)?;
        let revision = if parts.len() >= 4 && matches!(parts[2], "blob" | "resolve" | "tree") {
            parts[3]
        } else {
            "main"
        };
        let file = (parts.len() >= 5 && matches!(parts[2], "blob" | "resolve"))
            .then(|| parts[4..].join("/"));
        if let Some(file) = &file {
            validate_remote_path(file)?;
        }
        return Ok(Some(RepositoryInput {
            id,
            revision: revision.into(),
            file,
        }));
    }
    if query.contains('/') {
        validate_repository(query)?;
        return Ok(Some(RepositoryInput {
            id: query.into(),
            revision: "main".into(),
            file: None,
        }));
    }
    Ok(None)
}

fn decode_segment(segment: &str) -> Result<String> {
    let mut decoded = Vec::with_capacity(segment.len());
    let mut bytes = segment.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let high = bytes.next().and_then(|byte| char::from(byte).to_digit(16));
            let low = bytes.next().and_then(|byte| char::from(byte).to_digit(16));
            match (high, low) {
                (Some(high), Some(low)) => decoded.push((high * 16 + low) as u8),
                _ => return Err("The repository link contains invalid URL encoding.".into()),
            }
        } else {
            decoded.push(byte);
        }
    }
    String::from_utf8(decoded).map_err(|_| "The repository link is not valid UTF-8.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasted_file_links_decode_revision_and_filename_without_form_encoding() {
        let input = repository_input("https://huggingface.co/publisher/repo/blob/release%2Fone/sub/model%20a+1.gguf?download=true").unwrap().unwrap();
        assert_eq!(input.id, "publisher/repo");
        assert_eq!(input.revision, "release/one");
        assert_eq!(input.file.as_deref(), Some("sub/model a+1.gguf"));
        assert!(
            repository_input("https://huggingface.co/publisher/repo/blob/main/model%XX.gguf")
                .is_err()
        );
        assert!(repository_input(
            "https://huggingface.co/publisher/repo/blob/main/%2E%2E%2Foutside.gguf"
        )
        .is_err());
        assert!(repository_input("https://other.example/publisher/repo").is_err());
    }
}
