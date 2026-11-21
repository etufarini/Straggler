use crate::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub fn valid_prompt(text: &str) -> bool {
    text.len() <= 65_536 && !text.contains('\0')
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: Uuid,
    #[serde(flatten)]
    pub content: PresetText,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PresetText {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u32,
    presets: Vec<Preset>,
}

#[derive(Serialize, Deserialize)]
struct Export {
    format: String,
    version: u32,
    presets: Vec<PresetText>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportChoice {
    pub preset: PresetText,
    pub replace: bool,
}

pub struct SystemPrompts {
    path: PathBuf,
    writer: Mutex<()>,
}

fn validate_text(value: &PresetText) -> Result<()> {
    if value.name != value.name.trim()
        || !(1..=80).contains(&value.name.chars().count())
        || value.name.contains('\0')
    {
        return Err("Use a preset name of 1–80 characters after trimming.".into());
    }
    if value.description.chars().count() > 200 || value.description.contains('\0') {
        return Err("Use a description of at most 200 characters without NUL characters.".into());
    }
    if !valid_prompt(&value.prompt) {
        return Err("Use at most 65536 UTF-8 bytes without NUL characters.".into());
    }
    Ok(())
}

fn validate(presets: &[Preset]) -> Result<()> {
    let mut names = HashSet::new();
    let mut ids = HashSet::new();
    for preset in presets {
        validate_text(&preset.content)?;
        if !names.insert(preset.content.name.to_lowercase()) || !ids.insert(preset.id) {
            return Err("Preset names and identifiers must be unique.".into());
        }
        if preset.updated_at < preset.created_at {
            return Err("Invalid preset timestamps.".into());
        }
    }
    Ok(())
}

pub fn available_name(name: &str, existing: &[Preset]) -> String {
    let taken = |name: &str| {
        existing
            .iter()
            .any(|p| p.content.name.to_lowercase() == name.to_lowercase())
    };
    let name = name.trim();
    if !taken(name) {
        return name.to_owned();
    }
    for suffix in 2.. {
        let suffix = format!(" ({suffix})");
        let stem: String = name.chars().take(80 - suffix.len()).collect();
        let candidate = format!("{}{suffix}", stem.trim_end());
        if !taken(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

impl SystemPrompts {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            path: directory.join("system-prompts.json"),
            writer: Mutex::new(()),
        }
    }

    fn read(&self) -> Result<Vec<Preset>> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!(
                    "Cannot read system prompts. The file was kept: {error}"
                ))
            }
        };
        let read = || -> Result<Vec<Preset>> {
            let stored: Stored = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            if stored.version != 1 {
                return Err("Unsupported system prompts storage version.".into());
            }
            validate(&stored.presets)?;
            Ok(stored.presets)
        };
        read().map_err(|error| format!("Cannot read system prompts. The file was kept: {error}"))
    }

    pub fn list(&self) -> Result<Vec<Preset>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.read()
    }

    fn write(&self, presets: &[Preset]) -> Result<()> {
        validate(presets)?;
        let bytes = serde_json::to_vec_pretty(&Stored {
            version: 1,
            presets: presets.to_vec(),
        })
        .map_err(|e| e.to_string())?;
        crate::files::write_atomic(&self.path, &bytes)
    }

    pub fn save(&self, id: Option<Uuid>, mut content: PresetText) -> Result<Vec<Preset>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let mut presets = self.read()?;
        content.name = content.name.trim().into();
        let now = timestamp();
        if let Some(id) = id {
            let preset = presets
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("The preset no longer exists.")?;
            preset.content = content;
            preset.updated_at = now.max(preset.created_at);
        } else {
            presets.push(Preset {
                id: Uuid::new_v4(),
                content,
                created_at: now,
                updated_at: now,
            });
        }
        self.write(&presets)?;
        Ok(presets)
    }

    pub fn delete(&self, id: Uuid) -> Result<Vec<Preset>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let mut presets = self.read()?;
        if !presets.iter().any(|p| p.id == id) {
            return Err("The preset no longer exists.".into());
        }
        presets.retain(|p| p.id != id);
        self.write(&presets)?;
        Ok(presets)
    }

    pub fn import(&self, choices: Vec<ImportChoice>) -> Result<Vec<Preset>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let mut presets = self.read()?;
        for choice in choices {
            let mut content = choice.preset;
            content.name = content.name.trim().into();
            validate_text(&content)?;
            let existing = presets
                .iter_mut()
                .find(|p| p.content.name.to_lowercase() == content.name.to_lowercase());
            let now = timestamp();
            if let Some(existing) = existing.filter(|_| choice.replace) {
                existing.content = content;
                existing.updated_at = now.max(existing.created_at);
            } else {
                content.name = available_name(&content.name, &presets);
                presets.push(Preset {
                    id: Uuid::new_v4(),
                    content,
                    created_at: now,
                    updated_at: now,
                });
            }
        }
        self.write(&presets)?;
        Ok(presets)
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn export(presets: Vec<PresetText>) -> Result<String> {
    for preset in &presets {
        validate_text(preset)?;
    }
    serde_json::to_string_pretty(&Export {
        format: "straggler.system-prompts".into(),
        version: 1,
        presets,
    })
    .map_err(|e| e.to_string())
}

pub fn read_import(path: &Path) -> Result<Vec<PresetText>> {
    use std::io::Read;
    // Bound the preview allocation before parsing untrusted files.
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| format!("Cannot open the preset file: {e}"))?
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("The preset file exceeds 16 MiB.".into());
    }
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported prompt");
    parse_import(
        &bytes,
        path.extension().and_then(|s| s.to_str()).unwrap_or(""),
        name,
    )
}

pub fn parse_import(bytes: &[u8], extension: &str, name: &str) -> Result<Vec<PresetText>> {
    let mut presets = if matches!(extension.to_ascii_lowercase().as_str(), "md" | "txt") {
        vec![PresetText {
            name: name.into(),
            description: String::new(),
            prompt: String::from_utf8(bytes.to_vec())
                .map_err(|_| "The preset file must contain UTF-8 text.")?,
        }]
    } else {
        let value: serde_json::Value =
            serde_json::from_slice(bytes).map_err(|e| format!("Invalid preset file: {e}"))?;
        if value.get("format").and_then(|v| v.as_str()) == Some("straggler.system-prompts") {
            if value.get("version").and_then(|v| v.as_u64()) != Some(1) {
                return Err("Unsupported system prompts version. Choose a version 1 file.".into());
            }
            serde_json::from_value::<Export>(value)
                .map_err(|e| format!("Invalid preset file: {e}"))?
                .presets
        } else {
            let field = value.pointer("/operation/fields").and_then(|v| v.as_array())
                .and_then(|fields| fields.iter().find(|field| field.get("key").and_then(|v| v.as_str()) == Some("llm.prediction.systemPrompt")))
                .and_then(|field| field.get("value")).and_then(|v| v.as_str())
                .ok_or("Unsupported file. Choose Straggler prompts, UTF-8 Markdown or text, or an LM Studio preset with a system prompt.")?;
            vec![PresetText {
                name: value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or(name)
                    .into(),
                description: String::new(),
                prompt: field.into(),
            }]
        }
    };
    for preset in &mut presets {
        preset.name = preset.name.trim().into();
        validate_text(preset)?;
    }
    if presets.is_empty() {
        return Err("The file contains no presets.".into());
    }
    Ok(presets)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn text(name: &str, prompt: &str) -> PresetText {
        PresetText {
            name: name.into(),
            description: String::new(),
            prompt: prompt.into(),
        }
    }

    #[test]
    fn missing_roundtrip_duplicates_and_transactional_failure() {
        let dir = tempfile::tempdir().unwrap();
        let store = SystemPrompts::new(dir.path().into());
        assert!(store.list().unwrap().is_empty());
        let first = store.save(None, text(" Help ", "Caffè ☕")).unwrap();
        assert_eq!(first[0].content.name, "Help");
        assert!(store.save(None, text("HELP", "duplicate")).is_err());
        let serialized = export(first.iter().map(|p| p.content.clone()).collect()).unwrap();
        let imported = parse_import(serialized.as_bytes(), "json", "file").unwrap();
        assert_eq!(imported[0].prompt, "Caffè ☕");
        let choices = vec![
            ImportChoice {
                preset: text("help", "second"),
                replace: false,
            },
            ImportChoice {
                preset: text("Help", "third"),
                replace: false,
            },
        ];
        let all = store.import(choices).unwrap();
        assert_eq!(
            all.iter()
                .map(|p| p.content.name.as_str())
                .collect::<Vec<_>>(),
            ["Help", "help (2)", "Help (3)"]
        );
        let replaced = store
            .import(vec![ImportChoice {
                preset: text("HELP", "replaced"),
                replace: true,
            }])
            .unwrap();
        assert_eq!(replaced[0].id, first[0].id);
        assert_eq!(replaced[0].content.prompt, "replaced");
        let before = fs::read(&store.path).unwrap();
        assert!(store
            .import(vec![
                ImportChoice {
                    preset: text("valid", "ok"),
                    replace: false
                },
                ImportChoice {
                    preset: text("invalid", "\0"),
                    replace: false
                }
            ])
            .is_err());
        assert_eq!(fs::read(&store.path).unwrap(), before);
        store.delete(first[0].id).unwrap();
        assert_eq!(store.list().unwrap().len(), 2);
        fs::write(&store.path, b"broken").unwrap();
        assert!(store.list().unwrap_err().contains("file was kept"));
        assert!(store.save(None, text("New", "safe")).is_err());
        assert_eq!(fs::read(&store.path).unwrap(), b"broken");
    }

    #[test]
    fn limits_and_import_formats() {
        assert!(valid_prompt(&"é".repeat(32768)));
        assert!(!valid_prompt(&"é".repeat(32769)));
        assert!(!valid_prompt("\0"));
        assert!(validate_text(&text(&"a".repeat(80), "")).is_ok());
        assert!(validate_text(&text(&"a".repeat(81), "")).is_err());
        let mut invalid = text("Name", "");
        invalid.description = "é".repeat(201);
        assert!(validate_text(&invalid).is_err());
        assert_eq!(
            parse_import(b"# Help", "md", "Help").unwrap()[0].prompt,
            "# Help"
        );
        assert_eq!(
            parse_import(b"Plain", "txt", "Help").unwrap()[0].name,
            "Help"
        );
        assert!(parse_import(b"\xff", "txt", "Bad").is_err());
        let lm = br#"{"name":"LM", "operation":{"fields":[{"key":"llm.prediction.systemPrompt","value":"Be clear"}]}}"#;
        assert_eq!(
            parse_import(lm, "json", "file").unwrap()[0].prompt,
            "Be clear"
        );
        assert!(parse_import(br#"{"operation":{"fields":[]}}"#, "json", "file").is_err());
        assert!(parse_import(
            br#"{"format":"straggler.system-prompts","version":2,"presets":[]}"#,
            "json",
            "file"
        )
        .unwrap_err()
        .contains("version 1"));
        assert_eq!(parse_import(br#"{"format":"straggler.system-prompts","version":1,"extra":true,"presets":[{"name":"Help","prompt":"ok","extra":2}]}"#, "json", "file").unwrap().len(), 1);
    }
}
