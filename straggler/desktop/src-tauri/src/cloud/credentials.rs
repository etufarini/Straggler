use crate::{credentials, huggingface::credentials::TokenStore, Result};
use std::sync::Arc;

struct CloudTokenStore(String);
impl TokenStore for CloudTokenStore {
    fn read(&self) -> Result<Option<String>> {
        credentials::read_password(
            &credentials::entry(&format!("straggler.cloud.{}", self.0))?,
            "The system keychain could not read the cloud key.",
        )
    }
    fn write(&self, key: Option<&str>) -> Result<()> {
        credentials::write_password(
            &credentials::entry(&format!("straggler.cloud.{}", self.0))?,
            key,
            "The system keychain did not confirm the cloud key update.",
        )
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
