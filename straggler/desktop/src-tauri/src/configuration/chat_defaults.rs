//! Durable chat defaults reuse Settings field validation and profile serialization.
use super::{settings::SAMPLING_FIELDS, storage::Store};
use crate::{files::write_atomic, generation::chat_default_fields, Result, Settings};
use std::{collections::BTreeMap, fs};

pub fn merge(settings: &Settings, patch: BTreeMap<String, String>) -> Result<Settings> {
    let mut values = settings.fields();
    for (field, value) in patch {
        if !chat_default_fields().any(|allowed| allowed == field) {
            return Err(format!("{field} is not a chat default."));
        }
        values.insert(field, value);
    }
    Settings::from_fields(values)?.validated()
}

impl Store {
    pub fn read_chat_defaults(&self) -> Result<BTreeMap<String, String>> {
        let path = self.environment.config.join("chat-defaults.conf");
        let data = match fs::read_to_string(path) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(format!("Couldn’t read your chat defaults: {error}")),
        };
        let mut fields = BTreeMap::new();
        for line in data.lines() {
            let (name, value) = line
                .split_once('=')
                .ok_or("Invalid chat defaults record.")?;
            if !chat_default_fields().any(|field| field == name) || fields.contains_key(name) {
                return Err("Invalid or duplicate chat default field.".into());
            }
            let value = if name == "chat_system_prompt" {
                serde_json::from_str::<String>(value).map_err(|error| error.to_string())?
            } else {
                value.into()
            };
            fields.insert(name.into(), value);
        }
        merge(&Settings::default(), fields.clone())?;
        Ok(fields)
    }

    pub fn initial_settings(&self) -> Result<Settings> {
        let settings = Settings::from_environment(&self.environment)?;
        let mut saved = self.read_chat_defaults()?;
        // Explicit environment controls retain their existing precedence, including empty values.
        saved.retain(|field, _| {
            if !crate::generation::fields().any(|name| name == field) {
                return true;
            }
            let control = field.to_uppercase();
            let explicit = ["STRAGGLER_", "MIR_", "LLAMA_"].iter().any(|prefix| {
                self.environment
                    .value(&format!("{prefix}{control}"))
                    .is_some()
            });
            let preset = SAMPLING_FIELDS.contains(&field.as_str())
                && [
                    "STRAGGLER_GENERATION_PRESET",
                    "MIR_GENERATION_PRESET",
                    "LLAMA_GENERATION_PRESET",
                ]
                .iter()
                .any(|name| self.environment.value(name).is_some());
            !explicit && !preset
        });
        merge(&settings, saved)
    }

    pub fn save_chat_defaults(&self, settings: &Settings) -> Result<()> {
        // Do not silently overwrite an unreadable or corrupt previous record.
        self.read_chat_defaults()?;
        let serialized = settings.profile_data()?;
        let data = serialized
            .lines()
            .filter(|line| {
                line.split_once('=')
                    .is_some_and(|(name, _)| chat_default_fields().any(|field| field == name))
            })
            .map(|line| format!("{line}\n"))
            .collect::<String>();
        fs::create_dir_all(&self.environment.config).map_err(|error| error.to_string())?;
        write_atomic(
            &self.environment.config.join("chat-defaults.conf"),
            data.as_bytes(),
        )
    }
}
