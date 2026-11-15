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
}
impl WebSearchService {
    pub fn charge(&self, units: u32) -> Result<()> {
        self.budget.lock().map_err(|e| e.to_string())?.charge(units);
        Ok(())
    }
    pub async fn configured_provider(&self, id: &ProviderId) -> Result<Arc<dyn SearchProvider>> {
        let store_id = id.clone();
        let key = tokio::task::spawn_blocking(move || registry::SearchKeyStore(store_id).read())
            .await
            .map_err(|_| "The system keychain task failed.")??
            .ok_or("not_configured")?;
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
            registry::create(id, key.clone())?
                .verify()
                .await
                .map_err(|error| error.kind().to_owned())?;
        }
        let store_id = id.clone();
        tokio::task::spawn_blocking(move || {
            registry::SearchKeyStore(store_id).write(key.as_deref())
        })
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
        let response = provider.search(&request).await?;
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
