use super::types::*;
use async_trait::async_trait;
use url::Url;

#[async_trait]
pub trait SearchProvider: Send + Sync {
    fn id(&self) -> ProviderId;
    fn capabilities(&self) -> Capabilities;
    async fn search(&self, request: &SearchRequest) -> Result<SearchResponse, SearchError>;
    async fn fetch(&self, _url: &Url) -> Result<PageContent, SearchError> {
        Err(SearchError::ProviderUnavailable)
    }
    async fn quota(&self) -> Result<Option<QuotaStatus>, SearchError> {
        Ok(None)
    }
    async fn verify(&self) -> Result<(), SearchError>;
}
