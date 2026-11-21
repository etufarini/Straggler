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
pub struct CloudOrigin {
    pub provider_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Message {
    pub id: Uuid,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<crate::web_search::citations::Source>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_sources: Option<Vec<crate::project_search::Passage>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_sources: Option<Vec<crate::project_search::Passage>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_search: Option<crate::web_search::turn::TurnSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud: Option<CloudOrigin>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_customized: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branched_from: Option<BranchOrigin>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<ChatSummary>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatSummary {
    pub through_message_id: Uuid,
    pub text: String,
    pub model: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchOrigin {
    pub conversation_id: Uuid,
    pub message_id: Uuid,
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
    text_index: Mutex<crate::project_search::ChatTextIndex>,
}

impl History {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)
            .map_err(|e| format!("Cannot create chat storage: {e}"))?;
        Ok(Self {
            directory,
            writer: Arc::new(Mutex::new(())),
            project_storage: OnceLock::new(),
            text_index: Mutex::default(),
        })
    }

    pub fn list(&self) -> Result<Vec<Conversation>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        self.list_unlocked()
    }

    pub fn search_text(&self, query: &str) -> Result<Vec<Uuid>> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut index = self.text_index.lock().map_err(|error| error.to_string())?;
        let chats = self.list()?;
        index.matches(chats, query)
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
                    "Chat identifier does not match {}. The file was kept.",
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

    pub fn create_with_originals(
        &self,
        conversation: &Conversation,
        originals: &std::collections::BTreeMap<Uuid, attachments::ExtractedFile>,
    ) -> Result<()> {
        validate(conversation)?;
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        self.ensure_writable(conversation)?;
        self.create_with_attachments(conversation, |attachment, target| {
            let original = originals
                .get(&attachment.id)
                .ok_or("The original temporary attachment is unavailable.")?;
            if serde_json::to_value(&original.attachment).map_err(|e| e.to_string())?
                != serde_json::to_value(attachment).map_err(|e| e.to_string())?
            {
                return Err("The temporary attachment no longer matches its original.".into());
            }
            crate::files::write_atomic(target, &original.original)
        })
    }

    pub(crate) fn branch(&self, id: Uuid, message_id: Uuid) -> Result<Conversation> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.recover()?;
        let mut branch = self.read_one(id)?;
        self.ensure_writable(&branch)?;
        let response = branch.messages.iter().position(|message| {
            message.id == message_id
                && message.role == "assistant"
                && !matches!(message.status.as_str(), "streaming" | "error")
        });
        let response = response.ok_or("Choose a saved response to branch from.")?;
        if branch.summary.as_ref().is_some_and(|summary| {
            branch
                .messages
                .iter()
                .position(|message| message.id == summary.through_message_id)
                .is_some_and(|boundary| response <= boundary)
        }) {
            branch.summary = None;
        }
        branch.messages.truncate(response + 1);
        branch.id = Uuid::new_v4();
        let suffix = " (branch)";
        let title: String = branch
            .title
            .trim()
            .chars()
            .take(80 - suffix.len())
            .collect();
        branch.title = format!("{}{suffix}", title.trim_end());
        branch.title_customized = Some(true);
        branch.starred = None;
        branch.branched_from = Some(BranchOrigin {
            conversation_id: id,
            message_id,
        });
        branch.created_at = timestamp();
        branch.updated_at = branch.created_at;
        self.create_with_attachments(&branch, |attachment, target| {
            let bytes = fs::read(self.original_path(id, attachment))
                .map_err(|error| format!("Cannot copy {}: {error}", attachment.name))?;
            crate::files::write_atomic(target, &bytes)
        })?;
        Ok(branch)
    }

    // The caller holds the history writer lock and has checked project access.
    fn create_with_attachments(
        &self,
        conversation: &Conversation,
        write_attachment: impl Fn(&Attachment, &std::path::Path) -> Result<()>,
    ) -> Result<()> {
        let destination = self.directory.join(conversation.id.to_string());
        if destination.exists()
            || self
                .directory
                .join(format!("{}.json", conversation.id))
                .exists()
        {
            return Err("A chat with this identifier already exists.".into());
        }
        let stage = tempfile::tempdir_in(&self.directory).map_err(|e| e.to_string())?;
        let files = stage.path().join("attachments");
        fs::create_dir(&files).map_err(|e| e.to_string())?;
        for attachment in &conversation.attachments {
            write_attachment(
                attachment,
                &files.join(format!("{}.{}", attachment.id, attachment.extension)),
            )?;
        }
        if !conversation.attachments.is_empty() {
            crate::platform::rename_directory_exclusive(stage.path(), &destination)
                .map_err(|e| e.to_string())?;
        }
        if let Err(error) = self.write(conversation, true) {
            if destination.exists() {
                fs::remove_dir_all(&destination).map_err(|cleanup| {
                    format!("{error}. Cannot remove staged attachments: {cleanup}")
                })?;
            }
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn write(&self, conversation: &Conversation, create: bool) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|e| format!("Cannot create a chat file: {e}"))?;
        serde_json::to_writer(&mut file, conversation).map_err(|e| e.to_string())?;
        file.write_all(b"\n").map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        let path = self.directory.join(format!("{}.json", conversation.id));
        let result = if create {
            file.persist_noclobber(path)
        } else {
            file.persist(path)
        };
        result.map_err(|e| format!("Cannot save chat. Previous data was kept: {e}"))?;
        Ok(())
    }

    pub(crate) fn read_one(&self, id: Uuid) -> Result<Conversation> {
        let bytes = fs::read(self.directory.join(format!("{id}.json")))
            .map_err(|e| format!("Cannot read chat: {e}"))?;
        let conversation: Conversation =
            serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read chat: {e}"))?;
        if conversation.id != id {
            return Err("The chat identifier does not match its file.".into());
        }
        validate(&conversation)?;
        Ok(conversation)
    }

    pub(crate) fn original_path(&self, conversation: Uuid, attachment: &Attachment) -> PathBuf {
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
            .ok_or("This attachment is no longer in the chat.")?;
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
            .ok_or("This attachment is no longer in the chat.")?;
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
                return Err("Move the chat through the project action before saving.".into());
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
                .map_err(|e| format!("Cannot delete chat attachments: {e}"))?;
        }
        fs::remove_file(self.directory.join(format!("{id}.json")))
            .map_err(|e| format!("Cannot delete chat: {e}"))
    }
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn validate(conversation: &Conversation) -> Result<()> {
    if conversation.title_customized == Some(true) && conversation.title.chars().count() > 80 {
        return Err("Custom chat titles must contain at most 80 characters.".into());
    }
    if conversation.title.trim().is_empty() || conversation.title.len() > 1024 {
        return Err("Chat title must contain between 1 and 1024 bytes.".into());
    }
    if conversation
        .own_system_prompt
        .as_ref()
        .and_then(Option::as_ref)
        .is_some_and(|value| !crate::system_prompts::valid_prompt(value))
    {
        return Err("Invalid chat system prompt.".into());
    }
    if let Some(summary) = &conversation.summary {
        // Summaries become prompt input, so they share the bounded UTF-8/NUL rule.
        if summary.text.trim().is_empty()
            || !crate::system_prompts::valid_prompt(&summary.text)
            || summary.model.trim().is_empty()
            || summary.model.len() > 4096
            || summary.model.contains('\0')
            || summary.created_at == 0
            || !conversation
                .messages
                .iter()
                .any(|message| message.id == summary.through_message_id)
        {
            return Err("Invalid chat summary. Original messages were kept.".into());
        }
    }
    if let Some(options) = &conversation.options {
        if options
            .system_prompt
            .as_ref()
            .is_some_and(|value| !crate::system_prompts::valid_prompt(value))
            || options
                .reasoning
                .as_deref()
                .is_some_and(|value| !matches!(value, "auto" | "on" | "off"))
            || options
                .effort
                .as_deref()
                .is_some_and(|value| !crate::model::valid_effort(value))
        {
            return Err("Invalid chat options.".into());
        }
    }
    let mut identifiers = std::collections::HashSet::new();
    for attachment in &conversation.attachments {
        if let Some(image) = &attachment.image {
            if !crate::image_attachments::supported(&attachment.extension)
                || image.width == 0
                || image.height == 0
                || image.width > 2048
                || image.height > 2048
                || image.thumbnail.len() > 32768
                || !image.thumbnail.starts_with("data:image/png;base64,")
            {
                return Err("Invalid image attachment metadata.".into());
            }
        }
        if !attachments::supported(&attachment.extension)
            || attachment.size > attachments::MAX_FILE_BYTES
            || attachment.name.is_empty()
            || !identifiers.insert(attachment.id)
        {
            return Err("Invalid chat attachment.".into());
        }
    }
    for message in &conversation.messages {
        if let Some(cloud) = &message.cloud {
            if message.role != "assistant"
                || cloud.provider_id.is_empty()
                || cloud.provider_id.len() > 128
                || !cloud
                    .provider_id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                || cloud.name.trim().is_empty()
                || cloud.name.chars().count() > 80
                || cloud.name.chars().any(char::is_control)
            {
                return Err("Invalid saved cloud response origin.".into());
            }
        }
        crate::web_search::citations::validate_sources(&message.sources)?;
        if let Some(sources) = &message.attachment_sources {
            crate::project_search::validate(sources)?;
        }
        if let Some(sources) = &message.project_sources {
            crate::project_search::validate(sources)?;
        }
        if !matches!(message.role.as_str(), "user" | "assistant")
            || !matches!(
                message.status.as_str(),
                "complete" | "streaming" | "stopped" | "interrupted" | "error" | "length"
            )
        {
            return Err("Invalid chat message.".into());
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
            starred: None,
            title_customized: None,
            branched_from: None,
            created_at: 1,
            updated_at: 2,
            model: None,
            options: None,
            project_id: None,
            own_system_prompt: None,
            summary: None,
            attachments: Vec::new(),
            messages: vec![Message {
                id: Uuid::new_v4(),
                role: "assistant".into(),
                content: "Partial response".into(),
                reasoning: String::new(),
                sources: vec![],
                project_sources: None,
                attachment_sources: None,
                web_search: None,
                model: None,
                cloud: None,
                status: "streaming".into(),
                error: None,
                metrics: None,
                server_run_id: None,
            }],
        }
    }

    #[test]
    fn summaries_are_optional_bounded_atomic_and_follow_branch_boundaries() {
        let root = tempfile::tempdir().unwrap();
        let history = History::new(root.path().join("conversations")).unwrap();
        let mut chat = conversation();
        chat.messages[0].status = "complete".into();
        history.create(&chat).unwrap();
        let old = serde_json::to_value(&chat).unwrap();
        assert!(old.get("summary").is_none());
        assert!(serde_json::from_value::<Conversation>(old)
            .unwrap()
            .summary
            .is_none());
        let boundary = chat.messages[0].id;
        chat.messages.push(Message {
            id: Uuid::new_v4(),
            role: "user".into(),
            content: "Next question".into(),
            ..chat.messages[0].clone()
        });
        chat.messages.push(Message {
            id: Uuid::new_v4(),
            content: "Next answer".into(),
            ..chat.messages[0].clone()
        });
        chat.summary = Some(ChatSummary {
            through_message_id: boundary,
            text: "Preserved decisions".into(),
            model: "fixture".into(),
            created_at: 1,
        });
        history.save(&chat).unwrap();
        assert_eq!(
            history.read_one(chat.id).unwrap().summary.unwrap().text,
            "Preserved decisions"
        );
        assert!(history.branch(chat.id, boundary).unwrap().summary.is_none());
        assert!(history
            .branch(chat.id, chat.messages[2].id)
            .unwrap()
            .summary
            .is_some());
        let path = history.directory.join(format!("{}.json", chat.id));
        let previous = fs::read(&path).unwrap();
        for text in [String::new(), "bad\0text".into(), "あ".repeat(21846)] {
            chat.summary.as_mut().unwrap().text = text;
            assert!(history.save(&chat).is_err());
            assert_eq!(fs::read(&path).unwrap(), previous);
        }
        chat.summary.as_mut().unwrap().text = "Valid".into();
        chat.summary.as_mut().unwrap().through_message_id = Uuid::new_v4();
        assert!(history.save(&chat).is_err());
    }

    #[test]
    fn cloud_origin_is_optional_validated_and_round_trips() {
        let mut chat = conversation();
        assert!(validate(&chat).is_ok());
        chat.messages[0].cloud = Some(CloudOrigin {
            provider_id: "openrouter".into(),
            name: "OpenRouter".into(),
        });
        assert!(validate(&chat).is_ok());
        let bytes = serde_json::to_vec(&chat).unwrap();
        let loaded: Conversation = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            loaded.messages[0].cloud.as_ref().unwrap().name,
            "OpenRouter"
        );
        chat.messages[0].role = "user".into();
        assert!(validate(&chat).is_err());
    }

    #[test]
    fn optional_attachment_sources_roundtrip_without_changing_old_records() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().into()).unwrap();
        let mut chat = conversation();
        history.save(&chat).unwrap();
        assert!(history.list().unwrap()[0].messages[0]
            .attachment_sources
            .is_none());
        chat.messages[0].attachment_sources = Some(vec![crate::project_search::Passage {
            n: 1,
            project_id: None,
            conversation_id: Some(chat.id),
            file_id: Uuid::new_v4(),
            name: "notes.txt".into(),
            section: 1,
            text: "Saved excerpt".into(),
        }]);
        history.save(&chat).unwrap();
        assert_eq!(
            history.list().unwrap()[0].messages[0]
                .attachment_sources
                .as_ref()
                .unwrap()[0]
                .text,
            "Saved excerpt"
        );
        chat.messages[0].attachment_sources.as_mut().unwrap()[0].n = 2;
        assert!(history.save(&chat).is_err());
        assert_eq!(
            history.list().unwrap()[0].messages[0]
                .attachment_sources
                .as_ref()
                .unwrap()[0]
                .n,
            1
        );
    }

    #[test]
    fn chat_stars_are_optional_and_round_trip_with_custom_titles() {
        let directory = tempfile::tempdir().unwrap();
        let history = History::new(directory.path().to_owned()).unwrap();
        let mut chat = conversation();
        let legacy = serde_json::to_value(&chat).unwrap();
        assert!(legacy.get("starred").is_none());
        assert!(serde_json::from_value::<Conversation>(legacy)
            .unwrap()
            .starred
            .is_none());
        chat.title = "A custom title".into();
        chat.title_customized = Some(true);
        chat.starred = Some(true);
        history.save(&chat).unwrap();
        let loaded = history.list().unwrap();
        assert_eq!(loaded[0].title, chat.title);
        assert_eq!(loaded[0].starred, Some(true));
        chat.title = "a".repeat(81);
        assert!(history.save(&chat).is_err());
        assert_eq!(history.list().unwrap()[0].title, "A custom title");
    }

    #[test]
    fn branch_copies_only_the_chosen_history_and_owns_independent_files() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().join("conversations")).unwrap();
        let projects =
            crate::projects::Projects::new(dir.path().join("projects"), &history).unwrap();
        let project = crate::projects::Project {
            id: Uuid::new_v4(),
            name: "Research".into(),
            description: String::new(),
            instructions: String::new(),
            archived: false,
            starred: false,
            created_at: 1,
            updated_at: 1,
            files: vec![],
        };
        projects.save(&history, project.clone(), None).unwrap();
        let mut chat = conversation();
        chat.title = "😀".repeat(80);
        chat.starred = Some(true);
        chat.project_id = Some(project.id);
        chat.own_system_prompt = Some(Some("Stored prompt".into()));
        chat.messages[0].status = "complete".into();
        chat.messages[0].reasoning = "Retained reasoning".into();
        let response = chat.messages[0].id;
        let later = Message {
            id: Uuid::new_v4(),
            role: "user".into(),
            content: "A later turn".into(),
            reasoning: String::new(),
            ..chat.messages[0].clone()
        };
        chat.messages.push(later);
        history.create(&chat).unwrap();
        let file = dir.path().join("notes.txt");
        fs::write(&file, "Original attachment").unwrap();
        chat = history.add_attachment(chat.id, &file).unwrap();
        let old = history.original_path(chat.id, &chat.attachments[0]);

        let branch = history.branch(chat.id, response).unwrap();
        assert_eq!(branch.title.chars().count(), 80);
        assert!(branch.title.ends_with(" (branch)"));
        assert_eq!(branch.project_id, chat.project_id);
        assert_eq!(branch.own_system_prompt, chat.own_system_prompt);
        assert_eq!(branch.starred, None);
        assert_eq!(branch.messages.len(), 1);
        assert_eq!(branch.messages[0].reasoning, "Retained reasoning");
        assert!(history.branch(chat.id, chat.messages[1].id).is_err());

        let new = history.original_path(branch.id, &branch.attachments[0]);
        assert_ne!(old, new);
        fs::remove_file(&old).unwrap();
        assert!(history.branch(chat.id, response).is_err());
        assert_eq!(history.list().unwrap().len(), 2);
        history.delete(chat.id).unwrap();
        assert_eq!(fs::read_to_string(new).unwrap(), "Original attachment");
        let loaded = history.read_one(branch.id).unwrap();
        let origin = loaded.branched_from.unwrap();
        assert_eq!(origin.conversation_id, chat.id);
        assert_eq!(origin.message_id, response);
        let mut archived = project;
        archived.archived = true;
        projects.save(&history, archived, None).unwrap();
        assert!(history
            .branch(loaded.id, response)
            .unwrap_err()
            .contains("Restore"));
    }

    #[test]
    fn search_uses_saved_message_text_and_refreshes_after_edits_and_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let history = History::new(dir.path().join("conversations")).unwrap();
        let mut chat = conversation();
        chat.title = "Unrelated title".into();
        chat.messages[0].content = "The local project studies migrations of seabirds.".repeat(100);
        chat.messages[0].reasoning = "Excluded from the message index.".into();
        chat.messages[0].status = "complete".into();
        history.create(&chat).unwrap();

        assert_eq!(
            history.search_text("migrations seabirds").unwrap(),
            [chat.id]
        );
        assert!(history.search_text("unrelated").unwrap().is_empty());
        assert!(history.search_text("excluded").unwrap().is_empty());
        chat.messages[0].content = "The local project studies migrating whales.".into();
        history.save(&chat).unwrap();
        assert!(history.search_text("seabirds").unwrap().is_empty());
        assert_eq!(history.search_text("whales").unwrap(), [chat.id]);
        history.delete(chat.id).unwrap();
        assert!(history.search_text("whales").unwrap().is_empty());
        assert_eq!(fs::read_dir(&history.directory).unwrap().count(), 0);
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
