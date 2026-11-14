pub mod api;
pub mod catalog;
pub mod credentials;
pub mod downloads;
#[cfg(test)]
mod tests;

use crate::{Result, Runtime};
use api::{HubClient, Repository, SearchResults};
use credentials::SystemTokenStore;
use downloads::{DownloadPlan, Downloads};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub struct HuggingFace {
    pub hub: HubClient,
    pub downloads: Arc<Downloads>,
    repository: Mutex<Option<Repository>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub saved: bool,
    pub available: bool,
    pub error: Option<String>,
}

impl HuggingFace {
    pub fn new(data: &Path) -> Result<Self> {
        Self::with_hub(data, HubClient::new(Arc::new(SystemTokenStore))?)
    }

    pub fn with_hub(data: &Path, hub: HubClient) -> Result<Self> {
        Ok(Self {
            hub,
            downloads: Arc::new(Downloads::new(data)),
            repository: Mutex::new(None),
        })
    }

    pub fn token_status(&self) -> TokenStatus {
        match self.hub.tokens.read() {
            Ok(token) => TokenStatus {
                saved: token.is_some(),
                available: true,
                error: None,
            },
            Err(error) => TokenStatus {
                saved: false,
                available: false,
                error: Some(error),
            },
        }
    }

    pub fn save_token(&self, token: Option<&str>) -> Result<TokenStatus> {
        self.hub.tokens.write(token)?;
        Ok(self.token_status())
    }

    pub async fn search(&self, query: &str) -> Result<SearchResults> {
        let result = self.hub.search(query).await?;
        if let Some(repository) = &result.direct {
            *self.repository.lock().map_err(|e| e.to_string())? = Some(repository.clone());
        }
        Ok(result)
    }

    pub async fn repository(&self, id: &str, revision: &str) -> Result<Repository> {
        let repository = self.hub.repository(id, revision, None).await?;
        *self.repository.lock().map_err(|e| e.to_string())? = Some(repository.clone());
        Ok(repository)
    }

    pub fn download(
        &self,
        repository: &str,
        revision: &str,
        files: &[String],
        root: PathBuf,
    ) -> Result<Uuid> {
        let cached = self.repository.lock().map_err(|e| e.to_string())?;
        let repository = cached
            .as_ref()
            .filter(|value| value.id == repository && value.revision == revision)
            .ok_or("Refresh the repository before downloading this version.")?;
        self.downloads.start(
            DownloadPlan::selected(repository, files)?,
            root,
            self.hub.clone(),
        )
    }
}

impl Runtime {
    pub fn download_hf(&self, repository: &str, revision: &str, files: &[String]) -> Result<Uuid> {
        let config = self.inspect()?;
        let root = PathBuf::from(&config.models_dir)
            .canonicalize()
            .map_err(|_| "Choose a models folder before downloading.")?;
        if !self.native.model_access.permits(&root) {
            return Err("Choose the models folder again to restore access.".into());
        }
        self.hugging_face
            .download(repository, revision, files, root)
    }

    pub fn resume_hf(&self, id: Uuid) -> Result<()> {
        let config = self.inspect()?;
        let root = PathBuf::from(&config.models_dir)
            .canonicalize()
            .map_err(|_| "Choose the original models folder before resuming.")?;
        if !self.native.model_access.permits(&root) {
            return Err("Choose the models folder again to restore access.".into());
        }
        self.hugging_face
            .downloads
            .resume(id, &root, self.hugging_face.hub.clone())
    }
}
