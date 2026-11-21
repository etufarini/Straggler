use crate::{huggingface::credentials::TokenStore, Result};
use keyring_core::Error;
use std::sync::Arc;

struct CloudTokenStore(String);
impl TokenStore for CloudTokenStore {
    fn read(&self) -> Result<Option<String>> {
        match crate::credentials::entry(&format!("straggler.cloud.{}", self.0))?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err("The system keychain could not read the cloud key.".into()),
        }
    }
    fn write(&self, key: Option<&str>) -> Result<()> {
        let entry = crate::credentials::entry(&format!("straggler.cloud.{}", self.0))?;
        let result = match key {
            Some(key) => entry.set_password(key),
            None => entry.delete_credential(),
        };
        match result {
            Ok(()) => Ok(()),
            Err(Error::NoEntry) if key.is_none() => Ok(()),
            Err(_) => Err("The system keychain did not confirm the cloud key update.".into()),
        }
    }
}

pub trait CloudKeys: Send + Sync {
    fn store(&self, id: &str) -> Arc<dyn TokenStore>;
}

pub struct SystemCloudKeys;
impl CloudKeys for SystemCloudKeys {
    fn store(&self, id: &str) -> Arc<dyn TokenStore> {
        Arc::new(CloudTokenStore(id.into()))
    }
}

#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
#[derive(Default)]
pub struct MemoryCloudKeys(
    std::sync::Mutex<
        std::collections::HashMap<String, Arc<crate::web_search::registry::MemoryKeyStore>>,
    >,
);
#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
impl CloudKeys for MemoryCloudKeys {
    fn store(&self, id: &str) -> Arc<dyn TokenStore> {
        self.0.lock().unwrap().entry(id.into()).or_default().clone()
    }
}
