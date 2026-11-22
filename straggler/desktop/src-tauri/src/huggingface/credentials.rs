use crate::{credentials, Result};
use keyring_core::Entry;

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
        credentials::read_password(
            &Self::entry()?,
            "The system keychain could not read the Hugging Face token.",
        )
    }

    fn write(&self, token: Option<&str>) -> Result<()> {
        if let Some(token) = token {
            validate_token(token)?;
        }
        credentials::write_password(
            &Self::entry()?,
            token,
            "The system keychain did not confirm the token update. Unlock it and try again.",
        )
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
