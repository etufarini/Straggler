use crate::{
    attachments::{self, Attachment},
    Result,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    os::unix::fs::DirBuilderExt,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub id: Uuid,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<crate::stream::GenerationMetrics>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_run_id: Option<Uuid>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<Attachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<ConversationOptions>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
    #[serde(
        default,
        deserialize_with = "read_own_prompt",
        skip_serializing_if = "Option::is_none"
    )]
    pub own_system_prompt: Option<Option<String>>,
}

// Absence means a legacy record; explicit null preserves Settings inheritance.
fn read_own_prompt<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConversationOptions {
    pub system_prompt: Option<String>,
    pub reasoning: Option<String>,
    pub effort: Option<String>,
}

pub struct History {
    pub(crate) directory: PathBuf,
    pub(crate) writer: Arc<Mutex<()>>,
    pub(crate) project_storage: OnceLock<PathBuf>,
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
            writer: Arc::new(Mutex::new(())),
            project_storage: OnceLock::new(),
        })
    }

    pub fn list(&self) -> Result<Vec<Conversation>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        self.list_unlocked()
    }

    pub(crate) fn list_unlocked(&self) -> Result<Vec<Conversation>> {
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
        self.recover()?;
        self.ensure_writable(conversation)?;
        self.write(conversation, false)
    }

    pub fn create(&self, conversation: &Conversation) -> Result<()> {
        validate(conversation)?;
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        self.ensure_writable(conversation)?;
        self.write(conversation, true)
    }

    pub(crate) fn write(&self, conversation: &Conversation, create: bool) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|e| format!("Cannot create a conversation file: {e}"))?;
        serde_json::to_writer(&mut file, conversation).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        let path = self.directory.join(format!("{}.json", conversation.id));
        let result = if create {
            file.persist_noclobber(path)
        } else {
            file.persist(path)
        };
        result.map_err(|e| format!("Cannot save conversation. Previous data was kept: {e}"))?;
        Ok(())
    }

    pub(crate) fn read_one(&self, id: Uuid) -> Result<Conversation> {
        let bytes = fs::read(self.directory.join(format!("{id}.json")))
            .map_err(|e| format!("Cannot read conversation: {e}"))?;
        let conversation: Conversation =
            serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read conversation: {e}"))?;
        if conversation.id != id {
            return Err("The conversation identifier does not match its file.".into());
        }
        validate(&conversation)?;
        Ok(conversation)
    }

    fn original_path(&self, conversation: Uuid, attachment: &Attachment) -> PathBuf {
        self.directory
            .join(conversation.to_string())
            .join("attachments")
            .join(format!("{}.{}", attachment.id, attachment.extension))
    }

    pub fn add_attachment(&self, id: Uuid, path: &std::path::Path) -> Result<Conversation> {
        let extracted = attachments::extract(path)?;
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        let mut conversation = self.read_one(id)?;
        self.ensure_writable(&conversation)?;
        let original_path = self.original_path(id, &extracted.attachment);
        let parent = original_path
            .parent()
            .ok_or("Attachment storage has no parent directory.")?;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)
            .map_err(|e| format!("Cannot create attachment storage: {e}"))?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(&extracted.original)
            .and_then(|()| file.as_file().sync_all())
            .map_err(|e| format!("Cannot store the original attachment: {e}"))?;
        file.persist_noclobber(&original_path)
            .map_err(|e| format!("Cannot store the original attachment: {e}"))?;
        conversation.attachments.push(extracted.attachment);
        conversation.updated_at = timestamp();
        if let Err(error) = self.write(&conversation, false) {
            return match fs::remove_file(&original_path) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!(
                    "{error} Cannot remove the unreferenced copy: {cleanup}"
                )),
            };
        }
        Ok(conversation)
    }

    pub fn remove_attachment(&self, id: Uuid, attachment_id: Uuid) -> Result<Conversation> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        let previous = self.read_one(id)?;
        self.ensure_writable(&previous)?;
        let mut conversation = previous.clone();
        let index = conversation
            .attachments
            .iter()
            .position(|item| item.id == attachment_id)
            .ok_or("This attachment is no longer in the conversation.")?;
        let attachment = conversation.attachments.remove(index);
        conversation.updated_at = timestamp();
        self.write(&conversation, false)?;
        let path = self.original_path(id, &attachment);
        if path.exists() {
            if let Err(error) = fs::remove_file(path) {
                self.write(&previous, false).map_err(|rollback| format!("Cannot remove the original: {error}. Cannot restore its record: {rollback}"))?;
                return Err(format!(
                    "Cannot remove the original attachment. Its record was kept: {error}"
                ));
            }
        }
        Ok(conversation)
    }

    pub fn download_attachment(
        &self,
        id: Uuid,
        attachment_id: Uuid,
        destination: &std::path::Path,
    ) -> Result<()> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        let conversation = self.read_one(id)?;
        let attachment = conversation
            .attachments
            .iter()
            .find(|item| item.id == attachment_id)
            .ok_or("This attachment is no longer in the conversation.")?;
        let original = fs::read(self.original_path(id, attachment))
            .map_err(|e| format!("Cannot read the stored original attachment: {e}"))?;
        crate::files::write_atomic(destination, &original)
    }

    pub(crate) fn project_directory(&self) -> Result<PathBuf> {
        self.project_storage
            .get()
            .cloned()
            .ok_or_else(|| "Project storage is unavailable.".into())
    }

    pub(crate) fn recover(&self) -> Result<()> {
        if let Some(projects) = self.project_storage.get() {
            crate::projects::recover(projects, &self.directory)?;
        }
        Ok(())
    }

    fn ensure_writable(&self, conversation: &Conversation) -> Result<()> {
        if let Some(id) = conversation.project_id {
            crate::projects::ensure_active_at(&self.project_directory()?, id)?;
        }
        let path = self.directory.join(format!("{}.json", conversation.id));
        if path.exists() {
            let previous = self.read_one(conversation.id)?;
            if let Some(id) = previous.project_id {
                crate::projects::ensure_active_at(&self.project_directory()?, id)?;
            }
            if previous.project_id != conversation.project_id {
                return Err(
                    "Move the conversation through the project action before saving.".into(),
                );
            }
        }
        Ok(())
    }

    pub fn delete(&self, id: Uuid) -> Result<()> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        self.ensure_writable(&self.read_one(id)?)?;
        let attachments = self.directory.join(id.to_string());
        if attachments.exists() {
            fs::remove_dir_all(attachments)
                .map_err(|e| format!("Cannot delete conversation attachments: {e}"))?;
        }
        fs::remove_file(self.directory.join(format!("{id}.json")))
            .map_err(|e| format!("Cannot delete conversation: {e}"))
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate(conversation: &Conversation) -> Result<()> {
    if conversation.title.trim().is_empty() || conversation.title.len() > 1024 {
        return Err("Conversation title must contain between 1 and 1024 bytes.".into());
    }
    if conversation
        .own_system_prompt
        .as_ref()
        .and_then(Option::as_ref)
        .is_some_and(|value| value.len() > 65536 || value.contains('\0'))
    {
        return Err("Invalid conversation system prompt.".into());
    }
    if let Some(options) = &conversation.options {
        if options
            .system_prompt
            .as_ref()
            .is_some_and(|value| value.len() > 65536 || value.contains('\0'))
            || options
                .reasoning
                .as_deref()
                .is_some_and(|value| !matches!(value, "auto" | "on" | "off"))
            || options
                .effort
                .as_deref()
                .is_some_and(|value| !crate::model::valid_effort(value))
        {
            return Err("Invalid conversation options.".into());
        }
    }
    let mut identifiers = std::collections::HashSet::new();
    for attachment in &conversation.attachments {
        if !attachments::supported(&attachment.extension)
            || attachment.size > attachments::MAX_FILE_BYTES
            || attachment.name.is_empty()
            || !identifiers.insert(attachment.id)
        {
            return Err("Invalid conversation attachment.".into());
        }
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
            options: None,
            project_id: None,
            own_system_prompt: None,
            attachments: Vec::new(),
            messages: vec![Message {
                id: Uuid::new_v4(),
                role: "assistant".into(),
                content: "Partial response".into(),
                reasoning: String::new(),
                model: None,
                status: "streaming".into(),
                error: None,
                metrics: None,
                server_run_id: None,
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
    fn creating_an_import_never_overwrites_an_existing_conversation() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().to_owned()).unwrap();
        let mut chat = conversation();
        history.create(&chat).unwrap();
        chat.title = "Replacement".into();
        assert!(history.create(&chat).is_err());
        assert_eq!(history.list().unwrap()[0].title, "A local chat");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn attachment_copies_survive_source_deletion_and_are_removed_with_their_conversation() {
        let directory = tempfile::tempdir().unwrap();
        let history = History::new(directory.path().join("history")).unwrap();
        let chat = conversation();
        history.save(&chat).unwrap();
        let source = directory.path().join("notes.txt");
        fs::write(&source, "Stored attachment ☕").unwrap();
        let attached = history.add_attachment(chat.id, &source).unwrap();
        let attachment = &attached.attachments[0];
        fs::remove_file(&source).unwrap();
        let destination = directory.path().join("download.txt");
        history
            .download_attachment(chat.id, attachment.id, &destination)
            .unwrap();
        assert_eq!(
            fs::read_to_string(destination).unwrap(),
            "Stored attachment ☕"
        );
        assert_eq!(
            history.list().unwrap()[0].attachments[0].text,
            "Stored attachment ☕"
        );
        let original = history.original_path(chat.id, attachment);
        history.remove_attachment(chat.id, attachment.id).unwrap();
        assert!(!original.exists());
        assert!(history.list().unwrap()[0].attachments.is_empty());
        fs::write(&source, "Another attachment").unwrap();
        history.add_attachment(chat.id, &source).unwrap();
        history.delete(chat.id).unwrap();
        assert!(history.list().unwrap().is_empty());
        assert!(!history.directory.join(chat.id.to_string()).exists());
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
    fn loading_pre_project_history_preserves_original_bytes_and_prompt_semantics() {
        let directory = tempfile::tempdir().unwrap();
        let history = History::new(directory.path().join("conversations")).unwrap();
        let id = Uuid::new_v4();
        let original = format!(
            r#"{{
  "id": "{id}", "title": "Legacy ☕", "createdAt": 1, "updatedAt": 2,
  "model": null, "messages": [],
  "options": {{"systemPrompt": "", "reasoning": null, "effort": null}}
}}
"#
        );
        let path = history.directory.join(format!("{id}.json"));
        fs::write(&path, &original).unwrap();
        let loaded = history.list().unwrap();
        assert!(loaded[0].project_id.is_none());
        assert!(loaded[0].own_system_prompt.is_none());
        assert_eq!(
            loaded[0].options.as_ref().unwrap().system_prompt.as_deref(),
            Some("")
        );
        assert_eq!(fs::read(&path).unwrap(), original.as_bytes());
        let mut invalid = serde_json::to_value(&loaded[0]).unwrap();
        invalid["projectId"] = serde_json::json!("../outside");
        assert!(serde_json::from_value::<Conversation>(invalid).is_err());
        assert_eq!(fs::read(path).unwrap(), original.as_bytes());
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
