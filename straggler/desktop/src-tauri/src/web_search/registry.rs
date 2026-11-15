use super::{provider::SearchProvider, providers::tavily, types::*};
use crate::{huggingface::credentials::TokenStore, Result};
use keyring_core::Error;
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
        match crate::credentials::entry(&format!("straggler.web_search.{}", self.0 .0))?
            .get_password()
        {
            Ok(key) => Ok(Some(key)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err("The system keychain could not read the web search key.".into()),
        }
    }
    fn write(&self, key: Option<&str>) -> Result<()> {
        let entry = crate::credentials::entry(&format!("straggler.web_search.{}", self.0 .0))?;
        let result = match key {
            Some(key) => entry.set_password(key),
            None => entry.delete_credential(),
        };
        match result {
            Ok(()) => Ok(()),
            Err(Error::NoEntry) if key.is_none() => Ok(()),
            Err(_) => Err("The system keychain did not confirm the web search key update.".into()),
        }
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
