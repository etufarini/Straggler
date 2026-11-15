use crate::Result;
use keyring_core::{Entry, Error};

pub trait TokenStore: Send + Sync {
    fn read(&self) -> Result<Option<String>>;
    fn write(&self, token: Option<&str>) -> Result<()>;
}

pub struct SystemTokenStore;

impl SystemTokenStore {
    fn entry() -> Result<Entry> {
        crate::credentials::entry("huggingface-token")
    }
}

impl TokenStore for SystemTokenStore {
    fn read(&self) -> Result<Option<String>> {
        match Self::entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(Error::NoEntry) => Ok(None),
            Err(_) => Err("The system keychain could not read the Hugging Face token.".into()),
        }
    }

    fn write(&self, token: Option<&str>) -> Result<()> {
        if let Some(token) = token {
            validate_token(token)?;
        }
        let entry = Self::entry()?;
        let result = match token {
            Some(value) => entry.set_password(value),
            None => entry.delete_credential(),
        };
        match result {
            Ok(()) | Err(Error::NoEntry) if token.is_none() => Ok(()),
            Ok(()) => Ok(()),
            Err(_) => Err(
                "The system keychain did not confirm the token update. Unlock it and try again."
                    .into(),
            ),
        }
    }
}

pub fn validate_token(token: &str) -> Result<()> {
    if !token.starts_with("hf_")
        || token.len() > 4096
        || token.len() < 4
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err("Enter a Hugging Face access token beginning with hf_.".into());
    }
    Ok(())
}

#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
#[derive(Default)]
pub struct MemoryTokenStore(std::sync::Mutex<Option<String>>);

#[cfg(any(test, all(feature = "native-tests", debug_assertions)))]
impl TokenStore for MemoryTokenStore {
    fn read(&self) -> Result<Option<String>> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.clone())
    }
    fn write(&self, token: Option<&str>) -> Result<()> {
        if let Some(token) = token {
            validate_token(token)?;
        }
        *self.0.lock().map_err(|e| e.to_string())? = token.map(str::to_owned);
        Ok(())
    }
}
