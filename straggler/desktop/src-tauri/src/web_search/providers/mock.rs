use crate::web_search::{provider::SearchProvider, types::*};
use async_trait::async_trait;
use url::Url;

#[derive(Clone, Default)]
pub struct MockProvider {
    pub failure: Option<SearchError>,
    pub empty: bool,
}
#[async_trait]
impl SearchProvider for MockProvider {
    fn id(&self) -> ProviderId {
        ProviderId("mock".into())
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            fetch: true,
            ..Capabilities::default()
        }
    }
    async fn search(&self, request: &SearchRequest) -> Result<SearchResponse, SearchError> {
        request.validate()?;
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        let hits = if self.empty {
            vec![]
        } else {
            vec![SearchHit::new(
                "Simulated source".into(),
                Url::parse("https://example.org/source").unwrap(),
                "Development fixture. No remote request was made.",
            )?]
        };
        Ok(SearchResponse {
            query: request.query.clone(),
            hits,
            provider: self.id(),
            elapsed_ms: 0,
            cost_units: Some(0),
        })
    }
    async fn fetch(&self, url: &Url) -> Result<PageContent, SearchError> {
        Err(SearchError::FetchFailed { url: url.clone() })
    }
    async fn verify(&self) -> Result<(), SearchError> {
        self.failure.clone().map_or(Ok(()), Err)
    }
}
