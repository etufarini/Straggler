use super::{provider::SearchProvider, providers::tavily, types::*};
use crate::{credentials, huggingface::credentials::TokenStore, Result};
use std::sync::Arc;

pub fn providers() -> Vec<ProviderInfo> {
    vec![tavily::info()]
}
pub fn create(id: &ProviderId, key: String) -> Result<Arc<dyn SearchProvider>> {
    if *id == tavily::info().id {
        return Ok(Arc::new(tavily::Tavily::new(key)?));
    }
    Err("The selected web search service is unavailable.".into())
}
pub fn default_provider() -> ProviderId {
    providers()[0].id.clone()
}

pub struct SearchKeyStore(pub ProviderId);
impl TokenStore for SearchKeyStore {
    fn read(&self) -> Result<Option<String>> {
        credentials::read_password(
            &credentials::entry(&format!("straggler.web_search.{}", self.0 .0))?,
            "The system keychain could not read the web search key.",
        )
    }
    fn write(&self, key: Option<&str>) -> Result<()> {
        credentials::write_password(
            &credentials::entry(&format!("straggler.web_search.{}", self.0 .0))?,
            key,
            "The system keychain did not confirm the web search key update.",
        )
    }
}

#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
#[derive(Default)]
pub struct MemoryKeyStore(pub std::sync::Mutex<Option<String>>);
#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
impl TokenStore for MemoryKeyStore {
    fn read(&self) -> Result<Option<String>> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.clone())
    }
    fn write(&self, key: Option<&str>) -> Result<()> {
        *self.0.lock().map_err(|e| e.to_string())? = key.map(str::to_owned);
        Ok(())
    }
}
