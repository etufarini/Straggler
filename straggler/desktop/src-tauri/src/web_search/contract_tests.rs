use super::{provider::SearchProvider, providers::mock::MockProvider, types::*};
use async_trait::async_trait;
use url::Url;

// A second implementation depends only on the public contract.
struct IndependentProvider(MockProvider);
#[async_trait]
impl SearchProvider for IndependentProvider {
    fn id(&self) -> ProviderId {
        ProviderId("independent".into())
    }
    fn capabilities(&self) -> Capabilities {
        self.0.capabilities()
    }
    async fn search(&self, request: &SearchRequest) -> Result<SearchResponse, SearchError> {
        let mut result = self.0.search(request).await?;
        result.provider = self.id();
        Ok(result)
    }
    async fn fetch(&self, url: &Url) -> Result<PageContent, SearchError> {
        self.0.fetch(url).await
    }
    async fn verify(&self) -> Result<(), SearchError> {
        self.0.verify().await
    }
}

pub async fn assert_normal(provider: &dyn SearchProvider) {
    let response = provider
        .search(&SearchRequest {
            query: "contract".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(response.provider, provider.id());
    assert_eq!(response.query, "contract");
    assert!(!response.hits.is_empty());
    for hit in response.hits {
        validate_url(&hit.url).unwrap();
        assert_eq!(hit.domain, hit.url.host_str().unwrap());
        assert!(hit.snippet.chars().count() <= 600);
    }
}
#[tokio::test]
async fn providers_obey_the_same_contract() {
    for independent in [false, true] {
        let create = |fixture: MockProvider| -> Box<dyn SearchProvider> {
            if independent {
                Box::new(IndependentProvider(fixture))
            } else {
                Box::new(fixture)
            }
        };
        assert_normal(create(MockProvider::default()).as_ref()).await;
        let empty = create(MockProvider {
            empty: true,
            ..Default::default()
        });
        assert!(empty
            .search(&SearchRequest {
                query: "contract".into(),
                ..Default::default()
            })
            .await
            .unwrap()
            .hits
            .is_empty());
        for error in [
            SearchError::InvalidCredentials,
            SearchError::RateLimited {
                retry_after_s: Some(60),
            },
            SearchError::QuotaExhausted,
            SearchError::ProviderUnavailable,
            SearchError::Offline,
        ] {
            let provider = create(MockProvider {
                failure: Some(error.clone()),
                empty: false,
            });
            assert_eq!(
                provider
                    .search(&SearchRequest {
                        query: "contract".into(),
                        ..Default::default()
                    })
                    .await
                    .unwrap_err(),
                error
            );
        }
        let url = Url::parse("https://example.org/unreadable").unwrap();
        assert_eq!(
            create(MockProvider::default())
                .fetch(&url)
                .await
                .unwrap_err(),
            SearchError::FetchFailed { url }
        );
    }
}
#[test]
fn normalization_is_unicode_safe_and_rejects_non_web_urls() {
    let hit = SearchHit::new(
        "Title".into(),
        Url::parse("https://example.org/a").unwrap(),
        &"è".repeat(800),
    )
    .unwrap();
    assert_eq!(hit.snippet.chars().count(), 600);
    assert!(SearchHit::new(
        "Title".into(),
        Url::parse("file:///etc/passwd").unwrap(),
        ""
    )
    .is_err());
}
