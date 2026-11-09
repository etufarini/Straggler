use crate::Result;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, os::unix::fs::DirBuilderExt, path::PathBuf, sync::Mutex};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub id: Uuid,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conversation {
    pub id: Uuid,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub model: Option<String>,
    pub messages: Vec<Message>,
}

pub struct History {
    directory: PathBuf,
    writer: Mutex<()>,
}

impl History {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)
            .map_err(|e| format!("Cannot create conversation storage: {e}"))?;
        Ok(Self {
            directory,
            writer: Mutex::new(()),
        })
    }

    pub fn list(&self) -> Result<Vec<Conversation>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let mut conversations = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let data =
                fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
            let mut conversation: Conversation = serde_json::from_slice(&data)
                .map_err(|e| format!("Cannot read {}. The file was kept: {e}", path.display()))?;
            if path.file_stem().and_then(|s| s.to_str())
                != Some(conversation.id.to_string().as_str())
            {
                return Err(format!(
                    "Conversation identifier does not match {}. The file was kept.",
                    path.display()
                ));
            }
            validate(&conversation)?;
            // A terminated application can leave a response marked as streaming.
            for message in &mut conversation.messages {
                if message.status == "streaming" {
                    message.status = "interrupted".into();
                }
            }
            conversations.push(conversation);
        }
        conversations.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
        Ok(conversations)
    }

    pub fn save(&self, conversation: &Conversation) -> Result<()> {
        validate(conversation)?;
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|e| format!("Cannot create a conversation file: {e}"))?;
        serde_json::to_writer(&mut file, conversation).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist(self.directory.join(format!("{}.json", conversation.id)))
            .map_err(|e| format!("Cannot save conversation. Previous data was kept: {e}"))?;
        Ok(())
    }

    pub fn delete(&self, id: Uuid) -> Result<()> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        fs::remove_file(self.directory.join(format!("{id}.json")))
            .map_err(|e| format!("Cannot delete conversation: {e}"))
    }
}

fn validate(conversation: &Conversation) -> Result<()> {
    if conversation.title.trim().is_empty() || conversation.title.len() > 1024 {
        return Err("Conversation title must contain between 1 and 1024 bytes.".into());
    }
    for message in &conversation.messages {
        if !matches!(message.role.as_str(), "user" | "assistant")
            || !matches!(
                message.status.as_str(),
                "complete" | "streaming" | "stopped" | "interrupted" | "error" | "length"
            )
        {
            return Err("Invalid conversation message.".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conversation() -> Conversation {
        Conversation {
            id: Uuid::new_v4(),
            title: "A local chat".into(),
            created_at: 1,
            updated_at: 2,
            model: None,
            messages: vec![Message {
                id: Uuid::new_v4(),
                role: "assistant".into(),
                content: "Partial response".into(),
                reasoning: String::new(),
                status: "streaming".into(),
                error: None,
            }],
        }
    }

    #[test]
    fn round_trip_recovery_and_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().join("conversations")).unwrap();
        let mut chat = conversation();
        history.save(&chat).unwrap();
        let restored = history.list().unwrap();
        assert_eq!(restored[0].messages[0].content, "Partial response");
        assert_eq!(restored[0].messages[0].status, "interrupted");
        chat.messages[0].status = "complete".into();
        history.save(&chat).unwrap();
        assert_eq!(history.list().unwrap()[0].messages[0].status, "complete");
        history.delete(chat.id).unwrap();
        assert!(history.list().unwrap().is_empty());
    }

    #[test]
    fn bad_data_does_not_replace_existing_data() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().to_owned()).unwrap();
        let mut chat = conversation();
        history.save(&chat).unwrap();
        chat.messages[0].role = "shell".into();
        assert!(history.save(&chat).is_err());
        assert_eq!(history.list().unwrap()[0].messages[0].role, "assistant");
        fs::write(dir.path().join("broken.json"), b"not JSON").unwrap();
        assert!(history.list().unwrap_err().contains("file was kept"));
        assert!(dir.path().join("broken.json").exists());
    }

    #[test]
    fn request_diagnostics_round_trip_and_older_conversations_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().to_owned()).unwrap();
        let mut chat = conversation();
        chat.messages[0].status = "error".into();
        chat.messages[0].error = Some("Compute error.".into());
        history.save(&chat).unwrap();
        assert_eq!(
            history.list().unwrap()[0].messages[0].error.as_deref(),
            Some("Compute error.")
        );
        let mut legacy = serde_json::to_value(&chat).unwrap();
        legacy["messages"][0]
            .as_object_mut()
            .unwrap()
            .remove("error");
        fs::write(
            dir.path().join(format!("{}.json", chat.id)),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        assert!(history.list().unwrap()[0].messages[0].error.is_none());
    }
}
