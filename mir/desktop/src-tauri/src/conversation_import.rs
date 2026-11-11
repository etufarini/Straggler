use crate::Result;
use serde::Serialize;
use serde_json::Value;
use std::{fs, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedConversation {
    pub title: Option<String>,
    pub created_at: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub messages: Vec<ImportedMessage>,
}

#[derive(Debug, Serialize)]
pub struct ImportedMessage {
    pub role: String,
    pub content: String,
    pub reasoning: String,
    pub model: Option<String>,
}

fn optional_string(value: &Value, key: &str) -> Result<Option<String>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        _ => Err(format!("The {key} field must be text.")),
    }
}

pub fn parse(contents: &str) -> Result<ImportedConversation> {
    let root: Value =
        serde_json::from_str(contents).map_err(|e| format!("The file is not valid JSON: {e}"))?;
    let conversation = if root.is_array() {
        &root
    } else {
        if root.get("format").and_then(Value::as_str) != Some("mir.cpp/conversation") {
            return Err(
                "Expected a mir.cpp/conversation export or an array of role/content messages."
                    .into(),
            );
        }
        if root.get("version").and_then(Value::as_u64) != Some(1) {
            return Err("This conversation version is not supported. Use version 1.".into());
        }
        root.get("conversation")
            .filter(|value| value.is_object())
            .ok_or("The file must contain exactly one conversation object.")?
    };
    let values = if root.is_array() {
        root.as_array()
    } else {
        conversation.get("messages").and_then(Value::as_array)
    }
    .ok_or("The conversation must contain an array of messages.")?;
    let title = optional_string(conversation, "title")?;
    if title.as_ref().is_some_and(|text| text.len() > 1024) {
        return Err("The conversation title exceeds 1024 UTF-8 bytes.".into());
    }
    let mut imported = ImportedConversation {
        title,
        created_at: optional_string(conversation, "createdAt")?,
        model: optional_string(conversation, "model")?,
        system_prompt: None,
        messages: Vec::new(),
    };
    for (index, value) in values.iter().enumerate() {
        let role = value
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Message {} is missing its role.", index + 1))?;
        if !matches!(role, "system" | "user" | "assistant") {
            return Err(format!(
                "Message {} has an unsupported role: {role}.",
                index + 1
            ));
        }
        let content = value
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Message {} is missing text content.", index + 1))?;
        if role == "system" {
            let prompt = imported.system_prompt.get_or_insert_with(String::new);
            if !prompt.is_empty() {
                prompt.push_str("\n\n");
            }
            prompt.push_str(content);
            if prompt.len() > 65536 || prompt.contains('\0') {
                return Err("System instructions must use at most 65536 UTF-8 bytes without NUL characters.".into());
            }
        } else {
            let reasoning = if role == "assistant" {
                match optional_string(value, "reasoning_content")? {
                    Some(reasoning) => reasoning,
                    None => optional_string(value, "reasoning")?.unwrap_or_default(),
                }
            } else {
                String::new()
            };
            imported.messages.push(ImportedMessage {
                role: role.into(),
                content: content.into(),
                reasoning,
                model: if role == "assistant" {
                    optional_string(value, "model")?
                } else {
                    None
                },
            });
        }
    }
    Ok(imported)
}

pub fn read(path: &Path) -> Result<ImportedConversation> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("Cannot read the JSON file as UTF-8: {e}"))?;
    parse(&contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn mir_v1_preserves_metadata_system_text_and_assistant_reasoning() {
        let result = parse(&json!({
            "format": "mir.cpp/conversation", "version": 1, "exportedAt": "ignored",
            "conversation": {"title":"Example", "createdAt":"2026-11-11T00:00:00Z", "model":"example.gguf",
                "messages":[{"role":"system","content":"Instructions"}, {"role":"user","content":"Question","extra":true},
                    {"role":"assistant","content":"Answer","reasoning_content":"Thinking","model":"earlier.gguf"}]}
        }).to_string()).unwrap();
        assert_eq!(result.title.as_deref(), Some("Example"));
        assert_eq!(result.created_at.as_deref(), Some("2026-11-11T00:00:00Z"));
        assert_eq!(result.system_prompt.as_deref(), Some("Instructions"));
        assert_eq!(result.messages.len(), 2);
        assert_eq!(result.messages[1].reasoning, "Thinking");
        assert_eq!(result.messages[1].model.as_deref(), Some("earlier.gguf"));
    }

    #[test]
    fn plain_array_accepts_reasoning_alias_and_ignores_unknown_fields() {
        let result = parse(
            r#"[{"role":"assistant","content":"Partial","reasoning":"Alias","statistics":{}}]"#,
        )
        .unwrap();
        assert!(result.title.is_none());
        assert_eq!(result.messages[0].reasoning, "Alias");
        assert!(parse("[]").unwrap().messages.is_empty());
    }

    #[test]
    fn canonical_reasoning_takes_precedence_over_the_alias() {
        let imported = parse(r#"[{"role":"assistant","content":"Answer","reasoning_content":"Canonical","reasoning":42}]"#).unwrap();
        assert_eq!(imported.messages[0].reasoning, "Canonical");
    }

    #[test]
    fn invalid_inputs_are_rejected_without_writing_anything() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.json");
        for invalid in [
            "not JSON",
            "{}",
            r#"{"format":"other","version":1,"conversation":{}}"#,
            r#"{"format":"mir.cpp/conversation","version":2,"conversation":{"messages":[]}}"#,
            r#"{"format":"mir.cpp/conversation","version":1,"conversation":[{},{}]}"#,
            r#"[{"role":"tool","content":"No"}]"#,
            r#"[{"role":"user"}]"#,
            r#"[{"role":"user","content":null}]"#,
            r#"[{"messages":[]},{"messages":[]}]"#,
        ] {
            fs::write(&source, invalid).unwrap();
            assert!(read(&source).is_err(), "accepted {invalid}");
            assert_eq!(fs::read_to_string(&source).unwrap(), invalid);
            assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        }
    }
}
