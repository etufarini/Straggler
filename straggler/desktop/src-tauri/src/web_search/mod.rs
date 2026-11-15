pub mod provider;
pub mod types;
pub mod providers {
    pub mod mock;
    pub mod tavily;
}
pub mod budget;
pub mod citations;
#[cfg(test)]
mod contract_tests;
pub mod fetch_local;
pub mod registry;
pub mod tools;

use crate::{huggingface::credentials::TokenStore, Result};
use provider::SearchProvider;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use types::*;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    pub providers: Vec<ProviderInfo>,
    pub selected: ProviderId,
    pub saved: bool,
    pub error: Option<String>,
    pub error_kind: Option<String>,
    pub quota: Option<QuotaStatus>,
}
#[derive(Default)]
pub struct WebSearchService {
    budget: Mutex<budget::Budget>,
    operation: tokio::sync::Mutex<()>,
    provider_override: Option<Arc<dyn SearchProvider>>,
    key_override: Option<Arc<dyn TokenStore>>,
}
impl WebSearchService {
    // Explicit injection keeps contract and lifecycle tests independent of credentials and remote services.
    pub fn with_provider(provider: Arc<dyn SearchProvider>) -> Self {
        Self {
            provider_override: Some(provider),
            ..Self::default()
        }
    }

    pub fn with_provider_and_keys(
        provider: Arc<dyn SearchProvider>,
        keys: Arc<dyn TokenStore>,
    ) -> Self {
        Self {
            provider_override: Some(provider),
            key_override: Some(keys),
            ..Self::default()
        }
    }
    fn keys(&self, id: &ProviderId) -> Arc<dyn TokenStore> {
        self.key_override
            .clone()
            .unwrap_or_else(|| Arc::new(registry::SearchKeyStore(id.clone())))
    }
    pub fn clear_cache(&self) -> Result<()> {
        self.budget.lock().map_err(|e| e.to_string())?.clear_cache();
        Ok(())
    }
    pub fn charge(&self, units: u32) -> Result<()> {
        self.budget.lock().map_err(|e| e.to_string())?.charge(units);
        Ok(())
    }
    pub async fn configured_provider(&self, id: &ProviderId) -> Result<Arc<dyn SearchProvider>> {
        if self.key_override.is_none() {
            if let Some(provider) = &self.provider_override {
                return Ok(provider.clone());
            }
        }
        let store = self.keys(id);
        let key = tokio::task::spawn_blocking(move || store.read())
            .await
            .map_err(|_| "The system keychain task failed.")??
            .ok_or("not_configured")?;
        if let Some(provider) = &self.provider_override {
            return Ok(provider.clone());
        }
        registry::create(id, key)
    }
    pub async fn status(&self, id: &ProviderId, refresh: bool) -> SearchStatus {
        let mut status = SearchStatus {
            providers: registry::providers(),
            selected: id.clone(),
            saved: false,
            error: None,
            error_kind: None,
            quota: self.budget.lock().ok().and_then(|b| b.quota.clone()),
        };
        match self.configured_provider(id).await {
            Ok(provider) => {
                status.saved = true;
                if refresh {
                    match self.refresh_quota(provider.as_ref()).await {
                        Ok(quota) => status.quota = quota,
                        Err(error) => status.error_kind = Some(error.kind().into()),
                    }
                }
            }
            Err(error) if error == "not_configured" => {}
            Err(error) => status.error = Some(error),
        }
        status
    }
    pub async fn save_key(&self, id: &ProviderId, key: Option<String>) -> Result<SearchStatus> {
        let _operation = self.operation.lock().await;
        if let Some(key) = &key {
            if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_whitespace) {
                return Err("Enter a valid web search API key.".into());
            }
            if !self
                .budget
                .lock()
                .map_err(|e| e.to_string())?
                .allow_quota_read()
            {
                return Err("rate_limited".into());
            }
            self.provider_override
                .clone()
                .map(Ok)
                .unwrap_or_else(|| registry::create(id, key.clone()))?
                .verify()
                .await
                .map_err(|error| {
                    if let SearchError::RateLimited { retry_after_s } = &error {
                        if let Ok(mut budget) = self.budget.lock() {
                            budget.rate_limited(id.clone(), *retry_after_s);
                        }
                    }
                    error.kind().to_owned()
                })?;
        }
        let store = self.keys(id);
        tokio::task::spawn_blocking(move || store.write(key.as_deref()))
            .await
            .map_err(|_| "The system keychain task failed.")??;
        self.budget.lock().map_err(|e| e.to_string())?.clear();
        // No quota request here: verification just used the quota endpoint.
        Ok(self.status(id, false).await)
    }
    pub async fn search(
        &self,
        provider: &dyn SearchProvider,
        request: &SearchRequest,
    ) -> std::result::Result<(SearchResponse, bool), SearchError> {
        request.validate()?;
        let _operation = self.operation.lock().await;
        let mut request = request.clone();
        let caps = provider.capabilities();
        if !caps.recency && request.recency.take().is_some() {
            eprintln!("Web search: recency filter ignored by selected service.");
        }
        if !caps.region && request.region.take().is_some() {
            eprintln!("Web search: region filter ignored by selected service.");
        }
        if !caps.domain_filters
            && (!request.include_domains.is_empty() || !request.exclude_domains.is_empty())
        {
            eprintln!("Web search: domain filters ignored by selected service.");
            request.include_domains.clear();
            request.exclude_domains.clear();
        }
        if let Some(response) = self
            .budget
            .lock()
            .map_err(|_| SearchError::ProviderUnavailable)?
            .cached(&provider.id(), &request)
        {
            return Ok((response, true));
        }
        if let Some(seconds) = self
            .budget
            .lock()
            .map_err(|_| SearchError::ProviderUnavailable)?
            .retry_after(&provider.id())
        {
            return Err(SearchError::RateLimited {
                retry_after_s: Some(seconds),
            });
        }
        let response = match provider.search(&request).await {
            Ok(response) => response,
            Err(error @ SearchError::RateLimited { .. }) => {
                if let SearchError::RateLimited { retry_after_s } = &error {
                    self.budget
                        .lock()
                        .map_err(|_| SearchError::ProviderUnavailable)?
                        .rate_limited(provider.id(), *retry_after_s);
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        };
        self.budget
            .lock()
            .map_err(|_| SearchError::ProviderUnavailable)?
            .remember(&request, response.clone());
        Ok((response, false))
    }
    pub async fn refresh_quota(
        &self,
        provider: &dyn SearchProvider,
    ) -> std::result::Result<Option<QuotaStatus>, SearchError> {
        if !provider.capabilities().quota {
            return Ok(None);
        }
        let _operation = self.operation.lock().await;
        {
            let mut budget = self
                .budget
                .lock()
                .map_err(|_| SearchError::ProviderUnavailable)?;
            if !budget.allow_quota_read() {
                return Ok(budget.quota.clone());
            }
        }
        let quota = provider.quota().await?;
        self.budget
            .lock()
            .map_err(|_| SearchError::ProviderUnavailable)?
            .quota = quota.clone();
        Ok(quota)
    }
}

pub mod turn;

#[cfg(test)]
mod service_tests {
    use super::*;
    use providers::mock::MockProvider;

    #[tokio::test]
    async fn rejected_keys_keep_the_previous_secret_and_status_never_returns_it() {
        let keys = Arc::new(registry::MemoryKeyStore(Mutex::new(Some(
            "previous-secret".into(),
        ))));
        let service = WebSearchService::with_provider_and_keys(
            Arc::new(MockProvider {
                failure: Some(SearchError::InvalidCredentials),
                ..Default::default()
            }),
            keys.clone(),
        );
        let id = registry::default_provider();
        assert_eq!(
            service
                .save_key(&id, Some("rejected-secret".into()))
                .await
                .unwrap_err(),
            "invalid_credentials"
        );
        assert_eq!(keys.read().unwrap().as_deref(), Some("previous-secret"));
        let status = service.status(&id, false).await;
        assert!(status.saved);
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("previous-secret"));
        assert!(!json.contains("rejected-secret"));
        let status = service.save_key(&id, None).await.unwrap();
        assert!(!status.saved);
        assert!(keys.read().unwrap().is_none());
    }

    #[tokio::test]
    async fn verified_keys_stay_in_the_store_and_unsupported_filters_are_ignored() {
        let keys = Arc::new(registry::MemoryKeyStore::default());
        let service = WebSearchService::with_provider_and_keys(
            Arc::new(MockProvider::default()),
            keys.clone(),
        );
        let id = registry::default_provider();
        assert!(!service.status(&id, false).await.saved);
        assert!(
            service
                .save_key(&id, Some("new-secret".into()))
                .await
                .unwrap()
                .saved
        );
        assert_eq!(keys.read().unwrap().as_deref(), Some("new-secret"));
        let provider = service.configured_provider(&id).await.unwrap();
        let request = SearchRequest {
            query: "same".into(),
            recency: Some(Recency::Day),
            region: Some(CountryCode("IT".into())),
            include_domains: vec!["example.org".into()],
            ..Default::default()
        };
        assert!(!service.search(provider.as_ref(), &request).await.unwrap().1);
        assert!(
            service
                .search(
                    provider.as_ref(),
                    &SearchRequest {
                        query: "same".into(),
                        ..Default::default()
                    }
                )
                .await
                .unwrap()
                .1
        );
    }

    struct LockedStore;
    impl TokenStore for LockedStore {
        fn read(&self) -> Result<Option<String>> {
            Err("The system keychain is locked.".into())
        }
        fn write(&self, _: Option<&str>) -> Result<()> {
            Err("The system keychain is locked.".into())
        }
    }
    #[tokio::test]
    async fn keychain_storage_failures_are_explicit() {
        let service = WebSearchService::with_provider_and_keys(
            Arc::new(MockProvider::default()),
            Arc::new(LockedStore),
        );
        let id = registry::default_provider();
        assert_eq!(
            service.status(&id, false).await.error.as_deref(),
            Some("The system keychain is locked.")
        );
        assert_eq!(
            service
                .save_key(&id, Some("new-secret".into()))
                .await
                .unwrap_err(),
            "The system keychain is locked."
        );
    }
    struct LimitedProvider(std::sync::atomic::AtomicUsize);
    #[async_trait::async_trait]
    impl SearchProvider for LimitedProvider {
        fn id(&self) -> ProviderId {
            ProviderId("limited".into())
        }
        fn capabilities(&self) -> Capabilities {
            Capabilities::default()
        }
        async fn search(
            &self,
            _: &SearchRequest,
        ) -> std::result::Result<SearchResponse, SearchError> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err(SearchError::RateLimited {
                retry_after_s: Some(60),
            })
        }
        async fn verify(&self) -> std::result::Result<(), SearchError> {
            Ok(())
        }
    }
    #[tokio::test]
    async fn retry_after_prevents_another_remote_request() {
        let provider = LimitedProvider(std::sync::atomic::AtomicUsize::new(0));
        let service = WebSearchService::default();
        let request = SearchRequest {
            query: "retry".into(),
            ..Default::default()
        };
        assert!(matches!(
            service.search(&provider, &request).await,
            Err(SearchError::RateLimited { .. })
        ));
        assert!(matches!(
            service.search(&provider, &request).await,
            Err(SearchError::RateLimited { .. })
        ));
        assert_eq!(provider.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
