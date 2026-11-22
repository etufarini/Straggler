use crate::Result;
use keyring_core::{api::CredentialStoreApi, Entry, Error};

pub(crate) fn read_password(entry: &Entry, error_message: &str) -> Result<Option<String>> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(_) => Err(error_message.into()),
    }
}

pub(crate) fn write_password(
    entry: &Entry,
    value: Option<&str>,
    error_message: &str,
) -> Result<()> {
    let result = match value {
        Some(value) => entry.set_password(value),
        None => entry.delete_credential(),
    };
    match result {
        Ok(()) => Ok(()),
        Err(Error::NoEntry) if value.is_none() => Ok(()),
        Err(_) => Err(error_message.into()),
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    #[test]
    fn missing_passwords_and_repeated_deletion_are_successful() {
        let store = mock::Store::new().unwrap();
        let entry = store.build("straggler-test", "account", None).unwrap();
        assert_eq!(read_password(&entry, "Read failed").unwrap(), None);
        write_password(&entry, None, "Delete failed").unwrap();
        write_password(&entry, Some("secret"), "Write failed").unwrap();
        assert_eq!(
            read_password(&entry, "Read failed").unwrap().as_deref(),
            Some("secret")
        );
        write_password(&entry, None, "Delete failed").unwrap();
        write_password(&entry, None, "Delete failed").unwrap();
        assert_eq!(read_password(&entry, "Read failed").unwrap(), None);
    }

    #[test]
    fn failures_preserve_passwords_and_report_only_the_service_message() {
        let store = mock::Store::new().unwrap();
        let entry = store.build("straggler-test", "account", None).unwrap();
        entry.set_password("previous secret").unwrap();
        let credential = entry.as_any().downcast_ref::<mock::Cred>().unwrap();
        credential.set_error(Error::Invalid("private detail".into(), "secret".into()));
        assert_eq!(
            read_password(&entry, "Read failed").unwrap_err(),
            "Read failed"
        );
        // A missing credential is benign only when reading or deleting, never when saving.
        credential.set_error(Error::NoEntry);
        assert_eq!(
            write_password(&entry, Some("replacement"), "Write failed").unwrap_err(),
            "Write failed"
        );
        credential.set_error(Error::Invalid("private detail".into(), "secret".into()));
        assert_eq!(
            write_password(&entry, None, "Delete failed").unwrap_err(),
            "Delete failed"
        );
        assert_eq!(entry.get_password().unwrap(), "previous secret");
    }
}
