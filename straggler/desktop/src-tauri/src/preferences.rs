use crate::Result;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiPreferences {
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default)]
    pub web_search_notice_seen: bool,
    #[serde(default = "default_search_limit")]
    pub web_search_max_searches: u8,
    #[serde(default = "crate::web_search::registry::default_provider")]
    pub web_search_provider: crate::web_search::types::ProviderId,
    // Until the user chooses, the window width determines the initial presence layout.
    #[serde(default)]
    pub presence_expanded: Option<bool>,
}

fn default_search_limit() -> u8 {
    3
}
impl Default for UiPreferences {
    fn default() -> Self {
        Self {
            sidebar_collapsed: false,
            presence_expanded: None,
            web_search_notice_seen: false,
            web_search_max_searches: 3,
            web_search_provider: crate::web_search::registry::default_provider(),
        }
    }
}

pub struct Preferences {
    path: PathBuf,
    writer: Mutex<()>,
}

impl Preferences {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            path: directory.join("ui-preferences.json"),
            writer: Mutex::new(()),
        }
    }

    pub fn read(&self) -> Result<UiPreferences> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        match fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Cannot read desktop preferences. The file was kept: {e}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(UiPreferences::default())
            }
            Err(error) => Err(format!("Cannot read desktop preferences: {error}")),
        }
    }

    pub fn save(&self, preferences: &UiPreferences) -> Result<()> {
        if !(1..=5).contains(&preferences.web_search_max_searches)
            || !crate::web_search::registry::providers()
                .iter()
                .any(|info| info.id == preferences.web_search_provider)
        {
            return Err(
                "Choose an available search service and a search limit from 1 to 5.".into(),
            );
        }
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let directory = self
            .path
            .parent()
            .ok_or("Missing desktop data directory.")?;
        let mut file = tempfile::NamedTempFile::new_in(directory)
            .map_err(|e| format!("Cannot create desktop preferences: {e}"))?;
        serde_json::to_writer(&mut file, preferences).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(&self.path)
            .map_err(|e| format!("Cannot save desktop preferences. Previous data was kept: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_are_separate_and_invalid_data_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let preferences = Preferences::new(directory.path().to_owned());
        assert_eq!(preferences.read().unwrap(), UiPreferences::default());
        let selected = UiPreferences {
            sidebar_collapsed: true,
            presence_expanded: Some(false),
            ..Default::default()
        };
        preferences.save(&selected).unwrap();
        assert_eq!(preferences.read().unwrap(), selected);
        fs::write(&preferences.path, b"{broken").unwrap();
        assert!(preferences.read().unwrap_err().contains("file was kept"));
        assert_eq!(fs::read(&preferences.path).unwrap(), b"{broken");
        let unavailable = Preferences::new(directory.path().join("missing"));
        assert!(unavailable.save(&selected).is_err());
        assert_eq!(fs::read(&preferences.path).unwrap(), b"{broken");
    }
}
