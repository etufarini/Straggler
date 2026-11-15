use crate::Result;
use keyring_core::{api::CredentialStoreApi, Entry};

pub fn entry(account: &str) -> Result<Entry> {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|_| "The application identifier is unavailable.")?;
    let identifier = config["identifier"]
        .as_str()
        .ok_or("The application identifier is unavailable.")?;
    #[cfg(target_os = "linux")]
    let store = zbus_secret_service_keyring_store::Store::new();
    #[cfg(all(target_os = "macos", not(feature = "app-store")))]
    let store = apple_native_keyring_store::keychain::Store::new();
    #[cfg(all(target_os = "macos", feature = "app-store"))]
    let store = apple_native_keyring_store::protected::Store::new();
    store
        .and_then(|store| store.build(identifier, account, None))
        .map_err(|_| {
            "The system keychain is unavailable or locked. Unlock it and try again.".into()
        })
}
