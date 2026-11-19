use crate::{
    attachments,
    history::{Conversation, History},
    Result, Runtime,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use uuid::Uuid;

const UNDO_DURATION: Duration = Duration::from_secs(8);
const GENERATION_BUSY: &str = "Available when the current response finishes or is stopped";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFile {
    pub id: Uuid,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub included: bool,
    #[serde(default, skip_serializing)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<Uuid>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub starred: bool,
    pub archived: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub files: Vec<ProjectFile>,
}

// Text is kept outside project.json, but returned by IPC with each file.
#[derive(Debug)]
pub struct ProjectView {
    pub project: Project,
}

impl From<Project> for ProjectView {
    fn from(project: Project) -> Self {
        Self { project }
    }
}

impl Serialize for ProjectView {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serde_json::to_value(&self.project).map_err(serde::ser::Error::custom)?;
        if let Some(files) = value
            .get_mut("files")
            .and_then(serde_json::Value::as_array_mut)
        {
            for (value, file) in files.iter_mut().zip(&self.project.files) {
                value["text"] = serde_json::Value::String(file.text.clone());
            }
        }
        value.serialize(serializer)
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMutation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<Conversation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversations: Option<Vec<Conversation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted_conversation_ids: Option<Vec<Uuid>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undo_token: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

struct Undo {
    expires: Instant,
    action: UndoAction,
}

enum UndoAction {
    Archive {
        project_id: Uuid,
        expected: bool,
    },
    Move {
        conversation_id: Uuid,
        expected: Option<Uuid>,
        previous: Option<Uuid>,
    },
    File {
        project_id: Uuid,
        preceding: Vec<Uuid>,
        following: Vec<Uuid>,
        file: ProjectFile,
    },
}

pub struct Projects {
    directory: PathBuf,
    writer: Arc<Mutex<()>>,
    undo: Mutex<HashMap<Uuid, Undo>>,
    initial_cleanup: OnceLock<()>,
}

impl Projects {
    pub fn new(directory: PathBuf, history: &History) -> Result<Self> {
        if history
            .project_storage
            .get()
            .is_some_and(|current| *current != directory)
        {
            return Err("Chat storage already belongs to a different project store.".into());
        }
        let _ = history.project_storage.set(directory.clone());
        Ok(Self {
            directory,
            writer: history.writer.clone(),
            undo: Mutex::new(HashMap::new()),
            initial_cleanup: OnceLock::new(),
        })
    }

    fn cleanup_unreferenced_files(&self) -> Result<()> {
        // Undo is session-local. Unreferenced text from a terminated session no
        // longer has a possible consumer after transaction recovery completes.
        for project in self.list_unlocked()? {
            let directory = self.directory.join(project.id.to_string()).join("files");
            if !directory.exists() {
                continue;
            }
            let referenced: HashSet<Uuid> = project.files.iter().map(|file| file.id).collect();
            for entry in fs::read_dir(&directory)
                .map_err(|error| format!("Cannot inspect project text copies: {error}"))?
            {
                let entry = entry.map_err(|error| error.to_string())?;
                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()) != Some("txt") {
                    continue;
                }
                let id = path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .and_then(|name| Uuid::parse_str(name).ok());
                if id.is_some_and(|id| !referenced.contains(&id)) {
                    fs::remove_file(path).map_err(|error| {
                        format!("Cannot remove unused project text copy: {error}")
                    })?;
                }
            }
        }
        Ok(())
    }

    fn prepare(&self, history: &History) -> Result<()> {
        private_directory(&self.directory)?;
        recover(&self.directory, &history.directory)?;
        if self.initial_cleanup.get().is_none() {
            self.cleanup_unreferenced_files()?;
            let _ = self.initial_cleanup.set(());
        }
        let mut undo = self.undo.lock().map_err(|error| error.to_string())?;
        let expired: Vec<Uuid> = undo
            .iter()
            .filter_map(|(id, entry)| (entry.expires <= Instant::now()).then_some(*id))
            .collect();
        for id in expired {
            if let Some(Undo {
                action:
                    UndoAction::File {
                        project_id, file, ..
                    },
                ..
            }) = undo.get(&id)
            {
                let path = self.file_path(*project_id, file.id);
                if path.exists() {
                    fs::remove_file(path).map_err(|error| {
                        format!("Cannot remove expired project file copy: {error}")
                    })?;
                }
            }
            undo.remove(&id);
        }
        Ok(())
    }

    pub fn list(&self, history: &History) -> Result<Vec<ProjectView>> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        self.list_unlocked()
            .map(|projects| projects.into_iter().map(Into::into).collect())
    }

    fn list_unlocked(&self) -> Result<Vec<Project>> {
        let mut projects = Vec::new();
        for entry in fs::read_dir(&self.directory)
            .map_err(|error| format!("Cannot read projects: {error}"))?
        {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            let id = Uuid::parse_str(name).map_err(|_| {
                format!("Invalid project directory identifier: {name}. Its data was kept.")
            })?;
            projects.push(self.read(id)?);
        }
        projects.sort_by_key(|project| std::cmp::Reverse(project.updated_at));
        Ok(projects)
    }

    fn read(&self, id: Uuid) -> Result<Project> {
        let mut project = read_project(&self.directory, id)?;
        for file in &mut project.files {
            file.text = fs::read_to_string(self.file_path(id, file.id)).map_err(|error| {
                format!(
                    "Cannot read project file {}. Its record was kept: {error}",
                    file.name
                )
            })?;
        }
        Ok(project)
    }

    pub fn search(
        &self,
        history: &History,
        id: Uuid,
        query: &str,
        budget: usize,
    ) -> Result<Vec<crate::project_search::Passage>> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.prepare(history)?;
        let project = self.read(id)?;
        crate::project_search::search(
            &self.directory.join(id.to_string()).join("search-index"),
            &project,
            query,
            budget,
        )
    }

    pub fn file_text(&self, history: &History, id: Uuid, file: Uuid) -> Result<String> {
        let _guard = self.writer.lock().map_err(|e| e.to_string())?;
        self.prepare(history)?;
        self.read(id)?
            .files
            .into_iter()
            .find(|value| value.id == file)
            .map(|value| value.text)
            .ok_or_else(|| "This file is no longer in the project.".into())
    }

    fn file_path(&self, project: Uuid, file: Uuid) -> PathBuf {
        self.directory
            .join(project.to_string())
            .join("files")
            .join(format!("{file}.txt"))
    }

    fn write(&self, project: &Project) -> Result<()> {
        validate(project)?;
        let directory = self.directory.join(project.id.to_string());
        private_directory(&directory)?;
        write_json(&directory.join("project.json"), project)
    }

    fn add_undo(&self, action: UndoAction) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.undo.lock().map_err(|error| error.to_string())?.insert(
            id,
            Undo {
                expires: Instant::now() + UNDO_DURATION,
                action,
            },
        );
        Ok(id)
    }

    pub fn save(
        &self,
        history: &History,
        mut project: Project,
        generating: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        project.name = project.name.trim().to_owned();
        validate(&project)?;
        for other in self.list_unlocked()? {
            if other.id != project.id && other.name.to_lowercase() == project.name.to_lowercase() {
                return Err(format!(
                    "A project named “{}” already exists. Choose another name.",
                    project.name
                ));
            }
        }
        let path = self
            .directory
            .join(project.id.to_string())
            .join("project.json");
        let previous = if path.exists() {
            Some(self.read(project.id)?)
        } else {
            None
        };
        if let Some(previous) = &previous {
            if previous.archived && (project.archived || !same_content(previous, &project)) {
                return Err("Restore the project before making changes.".into());
            }
            if previous.archived != project.archived {
                ensure_project_idle(history, project.id, generating)?;
            }
            if previous.files.len() != project.files.len()
                || previous
                    .files
                    .iter()
                    .zip(&project.files)
                    .any(|(a, b)| !same_file(a, b))
            {
                return Err("Use the project file actions to add, remove or replace files.".into());
            }
            project.created_at = previous.created_at;
        } else if !project.files.is_empty() || project.archived {
            return Err("A new project must be active and have no files.".into());
        }
        project.updated_at = timestamp();
        if previous.is_none() {
            project.created_at = project.updated_at;
        }
        if let Err(error) = self.write(&project) {
            if previous.is_none() {
                let directory = self.directory.join(project.id.to_string());
                if directory.exists() {
                    fs::remove_dir_all(directory).map_err(|cleanup| {
                        format!("{error} Cannot remove incomplete project storage: {cleanup}")
                    })?;
                }
            }
            return Err(error);
        }
        let undo_token = match previous {
            Some(previous) if previous.archived != project.archived => {
                Some(self.add_undo(UndoAction::Archive {
                    project_id: project.id,
                    expected: project.archived,
                })?)
            }
            _ => None,
        };
        Ok(ProjectMutation {
            project: Some(project.into()),
            undo_token,
            ..Default::default()
        })
    }

    pub fn add_file(
        &self,
        history: &History,
        project_id: Uuid,
        path: &Path,
        characters_per_token: usize,
    ) -> Result<ProjectMutation> {
        self.add_or_replace_file(history, project_id, path, characters_per_token, None)
    }

    pub fn add_or_replace_file(
        &self,
        history: &History,
        project_id: Uuid,
        path: &Path,
        characters_per_token: usize,
        replace_file_id: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        if characters_per_token == 0 {
            return Err("Token estimates need a positive characters-per-token value.".into());
        }
        let extracted = attachments::extract(path)?;
        if extracted.attachment.image.is_some() {
            return Err("Images can be attached to chats, but not projects.".into());
        }
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        let mut project = self.read(project_id)?;
        ensure_active(&project)?;
        let replacement = replace_file_id
            .map(|id| {
                project
                    .files
                    .iter()
                    .position(|file| file.id == id)
                    .ok_or("This file is no longer in the project.")
            })
            .transpose()?;
        let attachment = extracted.attachment;
        let approximate_tokens = attachment
            .text
            .chars()
            .count()
            .div_ceil(characters_per_token);
        let file = ProjectFile {
            id: attachment.id,
            name: attachment.name,
            extension: attachment.extension,
            size: attachment.size,
            included: replacement.is_none_or(|index| project.files[index].included),
            text: attachment.text,
            tokens: Some(approximate_tokens),
            token_source: Some("approximate".into()),
            run_id: None,
        };
        let path = self.file_path(project_id, file.id);
        private_directory(
            path.parent()
                .ok_or("Project file storage has no parent directory.")?,
        )?;
        crate::files::write_atomic(&path, file.text.as_bytes())?;
        if let Some(index) = replacement {
            project.files[index] = file;
        } else {
            project.files.push(file);
        }
        project.updated_at = timestamp();
        if let Err(error) = self.write(&project) {
            return match fs::remove_file(&path) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!(
                    "{error} Cannot remove the unreferenced project copy: {cleanup}"
                )),
            };
        }
        Ok(ProjectMutation {
            project: Some(project.into()),
            ..Default::default()
        })
    }

    pub fn remove_file(
        &self,
        history: &History,
        project_id: Uuid,
        file_id: Uuid,
    ) -> Result<ProjectMutation> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        let mut project = self.read(project_id)?;
        ensure_active(&project)?;
        let index = project
            .files
            .iter()
            .position(|file| file.id == file_id)
            .ok_or("This file is no longer in the project.")?;
        let preceding = project.files[..index].iter().map(|file| file.id).collect();
        let following = project.files[index + 1..]
            .iter()
            .map(|file| file.id)
            .collect();
        let file = project.files.remove(index);
        project.updated_at = timestamp();
        self.write(&project)?;
        let undo_token = self.add_undo(UndoAction::File {
            project_id,
            preceding,
            following,
            file,
        })?;
        Ok(ProjectMutation {
            project: Some(project.into()),
            undo_token: Some(undo_token),
            ..Default::default()
        })
    }

    pub fn move_chat(
        &self,
        history: &History,
        conversation_id: Uuid,
        project_id: Option<Uuid>,
        generating: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        ensure_chat_idle(conversation_id, generating)?;
        let mut conversation = history.read_one(conversation_id)?;
        if let Some(id) = conversation.project_id {
            ensure_active_at(&self.directory, id)?;
        }
        if let Some(id) = project_id {
            ensure_active_at(&self.directory, id)?;
        }
        let previous = conversation.project_id;
        if previous == project_id {
            return Err("The chat is already in that location.".into());
        }
        change_membership(&mut conversation, project_id);
        history.write(&conversation, false)?;
        let token = self.add_undo(UndoAction::Move {
            conversation_id,
            expected: project_id,
            previous,
        })?;
        Ok(ProjectMutation {
            conversation: Some(conversation),
            undo_token: Some(token),
            ..Default::default()
        })
    }

    pub fn delete(
        &self,
        history: &History,
        project_id: Uuid,
        delete_chats: bool,
        generating: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        self.delete_with_cleanup(history, project_id, delete_chats, generating, |directory| {
            fs::remove_dir_all(directory)
        })
    }

    fn delete_with_cleanup(
        &self,
        history: &History,
        project_id: Uuid,
        delete_chats: bool,
        generating: Option<Uuid>,
        cleanup: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<ProjectMutation> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        let project = self.read(project_id)?;
        ensure_active(&project)?;
        ensure_project_idle(history, project_id, generating)?;
        let members: Vec<Conversation> = history
            .list_unlocked()?
            .into_iter()
            .filter(|chat| chat.project_id == Some(project_id))
            .collect();
        let transaction = self
            .directory
            .join(".transactions")
            .join(Uuid::new_v4().to_string());
        let backups = transaction.join("backups");
        private_directory(&backups)?;
        for chat in &members {
            let bytes = fs::read(history.directory.join(format!("{}.json", chat.id)))
                .map_err(|error| format!("Cannot back up chat: {error}"))?;
            crate::files::write_atomic(&backups.join(format!("{}.json", chat.id)), &bytes)?;
        }
        let mut journal = DeleteJournal {
            project_id,
            conversations: members.iter().map(|chat| chat.id).collect(),
            delete_chats,
            committed: false,
            rolled_back: false,
        };
        write_json(&transaction.join("operation.json"), &journal)?;
        let result = (|| {
            private_directory(&transaction.join("removed"))?;
            for chat in &members {
                if delete_chats {
                    fs::rename(
                        history.directory.join(format!("{}.json", chat.id)),
                        transaction
                            .join("removed")
                            .join(format!("{}.json", chat.id)),
                    )
                    .map_err(|error| format!("Cannot stage chat deletion: {error}"))?;
                    let attachments = history.directory.join(chat.id.to_string());
                    if attachments.exists() {
                        fs::rename(
                            attachments,
                            transaction.join("removed").join(chat.id.to_string()),
                        )
                        .map_err(|error| format!("Cannot stage chat attachments: {error}"))?;
                    }
                } else {
                    let mut detached = chat.clone();
                    change_membership(&mut detached, None);
                    history.write(&detached, false)?;
                }
            }
            fs::rename(
                self.directory.join(project_id.to_string()),
                transaction.join("project"),
            )
            .map_err(|error| format!("Cannot stage project deletion: {error}"))?;
            journal.committed = true;
            write_json(&transaction.join("operation.json"), &journal)
        })();
        if let Err(error) = result {
            rollback(&transaction, &self.directory, &history.directory, &journal).map_err(
                |rollback| {
                    format!("{error} Recovery is required before storage can be used: {rollback}")
                },
            )?;
            return Err(format!(
                "Cannot delete project. Previous data was restored: {error}"
            ));
        }
        let warning = cleanup(&transaction).err().map(|error| {
            format!(
                "Project deletion was saved, but temporary copies could not be removed: {error}"
            )
        });
        self.undo
            .lock()
            .map_err(|error| error.to_string())?
            .retain(|_, undo| !undo.action.affects_project(project_id));
        let conversations = if delete_chats {
            Vec::new()
        } else {
            members
                .iter()
                .map(|chat| history.read_one(chat.id))
                .collect::<Result<Vec<_>>>()?
        };
        Ok(ProjectMutation {
            warning,
            conversations: Some(conversations),
            deleted_conversation_ids: Some(if delete_chats {
                journal.conversations
            } else {
                Vec::new()
            }),
            ..Default::default()
        })
    }

    pub fn undo(
        &self,
        history: &History,
        token: Uuid,
        generating: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        let _guard = self.writer.lock().map_err(|error| error.to_string())?;
        self.prepare(history)?;
        let mut entries = self.undo.lock().map_err(|error| error.to_string())?;
        let entry = entries
            .get(&token)
            .ok_or("This action can no longer be undone.")?;
        let result = match &entry.action {
            UndoAction::Archive {
                project_id,
                expected,
            } => {
                let mut project = self.read(*project_id)?;
                if project.archived != *expected {
                    return Err(
                        "The project changed after this action. Undo is unavailable.".into(),
                    );
                }
                ensure_project_idle(history, *project_id, generating)?;
                project.archived = !expected;
                project.updated_at = timestamp();
                self.write(&project)?;
                ProjectMutation {
                    project: Some(project.into()),
                    ..Default::default()
                }
            }
            UndoAction::Move {
                conversation_id,
                expected,
                previous,
            } => {
                ensure_chat_idle(*conversation_id, generating)?;
                let mut chat = history.read_one(*conversation_id)?;
                if chat.project_id != *expected {
                    return Err("The chat moved again. Undo is unavailable.".into());
                }
                if let Some(id) = expected {
                    ensure_active_at(&self.directory, *id)?;
                }
                if let Some(id) = previous {
                    ensure_active_at(&self.directory, *id)?;
                }
                change_membership(&mut chat, *previous);
                history.write(&chat, false)?;
                ProjectMutation {
                    conversation: Some(chat),
                    ..Default::default()
                }
            }
            UndoAction::File {
                project_id,
                preceding,
                following,
                file,
            } => {
                let mut project = self.read(*project_id)?;
                ensure_active(&project)?;
                if project.files.iter().any(|item| item.id == file.id) {
                    return Err("The project file changed. Undo is unavailable.".into());
                }
                fs::read_to_string(self.file_path(*project_id, file.id))
                    .map_err(|error| format!("Cannot restore the project file: {error}"))?;
                let index = following
                    .iter()
                    .find_map(|id| project.files.iter().position(|item| item.id == *id))
                    .or_else(|| {
                        preceding.iter().rev().find_map(|id| {
                            project
                                .files
                                .iter()
                                .position(|item| item.id == *id)
                                .map(|position| position + 1)
                        })
                    })
                    .unwrap_or(0);
                project.files.insert(index, file.clone());
                project.updated_at = timestamp();
                self.write(&project)?;
                ProjectMutation {
                    project: Some(project.into()),
                    ..Default::default()
                }
            }
        };
        entries.remove(&token);
        Ok(result)
    }
}

impl UndoAction {
    fn affects_project(&self, id: Uuid) -> bool {
        match self {
            Self::Archive { project_id, .. } | Self::File { project_id, .. } => *project_id == id,
            Self::Move {
                expected, previous, ..
            } => *expected == Some(id) || *previous == Some(id),
        }
    }
}

fn same_file(a: &ProjectFile, b: &ProjectFile) -> bool {
    a.id == b.id
        && a.name == b.name
        && a.extension == b.extension
        && a.size == b.size
        && a.text == b.text
}

fn same_content(a: &Project, b: &Project) -> bool {
    a.name == b.name
        && a.description == b.description
        && a.instructions == b.instructions
        && a.starred == b.starred
        && a.files.len() == b.files.len()
        && a.files
            .iter()
            .zip(&b.files)
            .all(|(a, b)| same_file(a, b) && a.included == b.included)
}

fn change_membership(chat: &mut Conversation, project_id: Option<Uuid>) {
    let prompt = chat.own_system_prompt.clone().unwrap_or_else(|| {
        chat.options
            .as_ref()
            .and_then(|options| options.system_prompt.clone())
    });
    if chat.project_id.is_none() && project_id.is_some() {
        chat.own_system_prompt = Some(prompt);
    } else if project_id.is_none() {
        if let Some(options) = &mut chat.options {
            options.system_prompt = prompt;
        } else if prompt.is_some() {
            chat.options = Some(crate::history::ConversationOptions {
                system_prompt: prompt,
                ..Default::default()
            });
        }
    }
    chat.project_id = project_id;
    chat.updated_at = timestamp();
}

fn ensure_chat_idle(id: Uuid, generating: Option<Uuid>) -> Result<()> {
    if generating == Some(id) {
        return Err(GENERATION_BUSY.into());
    }
    Ok(())
}

fn ensure_project_idle(history: &History, id: Uuid, generating: Option<Uuid>) -> Result<()> {
    if let Some(chat) = generating {
        if history.read_one(chat)?.project_id == Some(id) {
            return Err(GENERATION_BUSY.into());
        }
    }
    Ok(())
}

fn ensure_active(project: &Project) -> Result<()> {
    if project.archived {
        return Err("Restore the project before making changes.".into());
    }
    Ok(())
}

pub(crate) fn ensure_active_at(directory: &Path, id: Uuid) -> Result<()> {
    ensure_active(&read_project(directory, id)?)
}

fn read_project(directory: &Path, id: Uuid) -> Result<Project> {
    let bytes = fs::read(directory.join(id.to_string()).join("project.json"))
        .map_err(|error| format!("Cannot read project {id}. Its chats were kept: {error}"))?;
    let project: Project = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cannot read project {id}. Its data was kept: {error}"))?;
    if project.id != id {
        return Err(
            "The project identifier does not match its directory. Its data was kept.".into(),
        );
    }
    validate(&project)?;
    Ok(project)
}

fn validate(project: &Project) -> Result<()> {
    if project.name.trim().is_empty() {
        return Err("Enter a name for the project.".into());
    }
    if project.name.chars().count() > 80 {
        return Err("Use 80 characters or fewer for the project name.".into());
    }
    if project.description.chars().count() > 200 {
        return Err("Use 200 characters or fewer for the description.".into());
    }
    if project.name.contains('\0')
        || project.description.contains('\0')
        || project.instructions.contains('\0')
    {
        return Err("Project text cannot contain NUL characters.".into());
    }
    let mut ids = HashSet::new();
    for file in &project.files {
        if !ids.insert(file.id)
            || file.name.is_empty()
            || !attachments::document_supported(&file.extension)
            || file.size > attachments::MAX_FILE_BYTES
            || file
                .token_source
                .as_deref()
                .is_some_and(|source| !matches!(source, "server" | "approximate"))
        {
            return Err("Invalid project file metadata.".into());
        }
    }
    Ok(())
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn private_directory(path: &Path) -> Result<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|error| format!("Cannot create project storage: {error}"))
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path
        .parent()
        .ok_or("Project storage has no parent directory.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Cannot create project record: {error}"))?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n")
        .and_then(|()| file.as_file().sync_all())
        .map_err(|error| format!("Cannot write project record: {error}"))?;
    file.persist(path)
        .map_err(|error| format!("Cannot save project. Previous data was kept: {error}"))?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteJournal {
    project_id: Uuid,
    conversations: Vec<Uuid>,
    delete_chats: bool,
    committed: bool,
    #[serde(default)]
    rolled_back: bool,
}

pub(crate) fn recover(projects: &Path, history: &Path) -> Result<()> {
    let transactions = projects.join(".transactions");
    if !transactions
        .try_exists()
        .map_err(|error| format!("Cannot inspect project recovery storage: {error}"))?
    {
        return Ok(());
    }
    for entry in fs::read_dir(&transactions)
        .map_err(|error| format!("Cannot inspect project recovery records: {error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let directory = entry.path();
        let record = directory.join("operation.json");
        if !record.exists() {
            fs::remove_dir_all(&directory)
                .map_err(|error| format!("Cannot remove unused project staging: {error}"))?;
            continue;
        }
        let journal: DeleteJournal =
            serde_json::from_slice(&fs::read(&record).map_err(|error| error.to_string())?)
                .map_err(|error| {
                    format!("Cannot read project recovery record. Its data was kept: {error}")
                })?;
        if journal.committed || journal.rolled_back {
            fs::remove_dir_all(&directory)
                .map_err(|error| format!("Cannot finish project deletion cleanup: {error}"))?;
        } else {
            rollback(&directory, projects, history, &journal)?;
        }
    }
    Ok(())
}

fn rollback(
    transaction: &Path,
    projects: &Path,
    history: &Path,
    journal: &DeleteJournal,
) -> Result<()> {
    let saved_project = transaction.join("project");
    if saved_project.exists() {
        fs::rename(saved_project, projects.join(journal.project_id.to_string()))
            .map_err(|error| format!("Cannot restore project: {error}"))?;
    }
    for id in &journal.conversations {
        let bytes = fs::read(transaction.join("backups").join(format!("{id}.json")))
            .map_err(|error| format!("Cannot read chat recovery copy: {error}"))?;
        crate::files::write_atomic(&history.join(format!("{id}.json")), &bytes)?;
        let attachments = transaction.join("removed").join(id.to_string());
        if attachments.exists() {
            fs::rename(attachments, history.join(id.to_string()))
                .map_err(|error| format!("Cannot restore chat attachments: {error}"))?;
        }
    }
    // Cleanup can fail after removing a backup. Mark restoration complete first,
    // so a later recovery never attempts to replay partially reclaimed backups.
    let mut completed = journal.clone();
    completed.committed = false;
    completed.rolled_back = true;
    write_json(&transaction.join("operation.json"), &completed)?;
    fs::remove_dir_all(transaction)
        .map_err(|error| format!("Cannot clean restored project staging: {error}"))
}

impl Runtime {
    pub fn save_project(&self, project: Project) -> Result<ProjectMutation> {
        let active = self.active.lock().map_err(|error| error.to_string())?;
        self.projects
            .save(&self.history, project, active.conversation_id)
    }

    pub fn move_project_chat(
        &self,
        conversation_id: Uuid,
        project_id: Option<Uuid>,
    ) -> Result<ProjectMutation> {
        let active = self.active.lock().map_err(|error| error.to_string())?;
        self.projects.move_chat(
            &self.history,
            conversation_id,
            project_id,
            active.conversation_id,
        )
    }

    pub fn delete_project(&self, project_id: Uuid, delete_chats: bool) -> Result<ProjectMutation> {
        let active = self.active.lock().map_err(|error| error.to_string())?;
        self.projects.delete(
            &self.history,
            project_id,
            delete_chats,
            active.conversation_id,
        )
    }

    pub fn undo_project(&self, token: Uuid) -> Result<ProjectMutation> {
        let active = self.active.lock().map_err(|error| error.to_string())?;
        self.projects
            .undo(&self.history, token, active.conversation_id)
    }

    pub fn branch_conversation(&self, id: Uuid, message_id: Uuid) -> Result<Conversation> {
        self.ensure_persistent(id)?;
        let active = self.active.lock().map_err(|error| error.to_string())?;
        ensure_chat_idle(id, active.conversation_id)?;
        self.history.branch(id, message_id)
    }

    pub fn delete_conversation(&self, id: Uuid) -> Result<()> {
        let active = self.active.lock().map_err(|error| error.to_string())?;
        ensure_chat_idle(id, active.conversation_id)?;
        self.history.delete(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::ConversationOptions;

    struct Storage {
        directory: tempfile::TempDir,
        history: History,
        projects: Projects,
    }

    impl Storage {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let history = History::new(directory.path().join("conversations")).unwrap();
            let projects = Projects::new(directory.path().join("projects"), &history).unwrap();
            Self {
                directory,
                history,
                projects,
            }
        }

        fn create(&self, name: &str) -> Project {
            self.projects
                .save(&self.history, project(name), None)
                .unwrap()
                .project
                .unwrap()
                .project
        }

        fn chat(&self, prompt: Option<&str>) -> Conversation {
            let chat = Conversation {
                id: Uuid::new_v4(),
                title: "A conversation".into(),
                starred: None,
                title_customized: None,
                branched_from: None,
                created_at: 1,
                updated_at: 2,
                model: None,
                messages: vec![],
                attachments: vec![],
                project_id: None,
                own_system_prompt: None,
                options: Some(ConversationOptions {
                    system_prompt: prompt.map(str::to_owned),
                    reasoning: Some("on".into()),
                    effort: None,
                }),
            };
            self.history.create(&chat).unwrap();
            chat
        }
    }

    fn project(name: &str) -> Project {
        Project {
            id: Uuid::new_v4(),
            name: name.into(),
            description: String::new(),
            instructions: String::new(),
            starred: false,
            archived: false,
            created_at: 0,
            updated_at: 0,
            files: vec![],
        }
    }

    #[test]
    fn replacement_preserves_inclusion_and_failed_extraction_preserves_the_old_file() {
        let storage = Storage::new();
        let project = storage.create("Replacement");
        let source = storage.directory.path().join("original.txt");
        fs::write(&source, "Original contents").unwrap();
        let mut project = storage
            .projects
            .add_file(&storage.history, project.id, &source, 4)
            .unwrap()
            .project
            .unwrap()
            .project;
        project.files[0].included = false;
        let old_id = project.files[0].id;
        storage
            .projects
            .save(&storage.history, project.clone(), None)
            .unwrap();
        let missing = storage.directory.path().join("missing.txt");
        assert!(storage
            .projects
            .add_or_replace_file(&storage.history, project.id, &missing, 4, Some(old_id))
            .is_err());
        assert_eq!(
            storage.projects.list(&storage.history).unwrap()[0]
                .project
                .files[0]
                .text,
            "Original contents"
        );
        fs::write(&source, "New contents").unwrap();
        let replaced = storage
            .projects
            .add_or_replace_file(&storage.history, project.id, &source, 4, Some(old_id))
            .unwrap()
            .project
            .unwrap()
            .project;
        assert_eq!(replaced.files.len(), 1);
        assert!(!replaced.files[0].included);
        assert_eq!(replaced.files[0].text, "New contents");
        assert_ne!(replaced.files[0].id, old_id);
    }

    #[test]
    fn validates_names_and_description_without_changing_saved_projects() {
        let storage = Storage::new();
        assert!(storage
            .projects
            .save(&storage.history, project("  "), None)
            .unwrap_err()
            .contains("Enter a name"));
        let mut original = storage.create("  Research  ");
        assert_eq!(original.name, "Research");
        let duplicate = storage
            .projects
            .save(&storage.history, project("RESEARCH"), None)
            .unwrap_err();
        assert!(duplicate.contains("already exists"));
        original.name = "research".into();
        storage
            .projects
            .save(&storage.history, original.clone(), None)
            .unwrap();
        original.archived = true;
        storage
            .projects
            .save(&storage.history, original, None)
            .unwrap();
        assert!(storage
            .projects
            .save(&storage.history, project("Research"), None)
            .is_err());
        storage.create(&"☕".repeat(80));
        assert!(storage
            .projects
            .save(&storage.history, project(&"☕".repeat(81)), None)
            .is_err());
        let mut description = project("Description");
        description.description = "é".repeat(200);
        storage
            .projects
            .save(&storage.history, description.clone(), None)
            .unwrap();
        description.description.push('é');
        assert!(storage
            .projects
            .save(&storage.history, description, None)
            .is_err());
        assert_eq!(storage.projects.list(&storage.history).unwrap().len(), 3);
    }

    #[test]
    fn extraction_uses_supplied_token_ratio_and_rejects_zero_before_reading_or_writing() {
        let storage = Storage::new();
        let missing_source = storage.directory.path().join("missing.txt");
        let invalid = storage
            .projects
            .add_file(&storage.history, Uuid::new_v4(), &missing_source, 0)
            .unwrap_err();
        assert!(invalid.contains("positive characters-per-token"));
        assert!(!storage.projects.directory.exists());
        let project = storage.create("Supplied estimate");
        let source = storage.directory.path().join("unicode.txt");
        fs::write(&source, "é☕x").unwrap();
        let result = storage
            .projects
            .add_file(&storage.history, project.id, &source, 2)
            .unwrap();
        assert_eq!(result.project.unwrap().project.files[0].tokens, Some(2));
        assert_eq!(fs::read_to_string(source).unwrap(), "é☕x");
    }

    #[test]
    fn ipc_contract_contains_text_but_disk_records_contain_only_file_metadata() {
        let storage = Storage::new();
        let project = storage.create("Notes");
        let source = storage.directory.path().join("notes.md");
        fs::write(&source, "# Unicode ☕").unwrap();
        let result = storage
            .projects
            .add_file(&storage.history, project.id, &source, 4)
            .unwrap();
        let value = serde_json::to_value(&result).unwrap();
        let file = &value["project"]["files"][0];
        assert_eq!(file["text"], "# Unicode ☕");
        assert_eq!(file["included"], true);
        assert_eq!(file["extension"], "md");
        assert!(file["id"].is_string());
        assert!(value.get("undoToken").is_none());
        let project = result.project.unwrap().project;
        let disk: serde_json::Value = serde_json::from_slice(
            &fs::read(
                storage
                    .projects
                    .directory
                    .join(project.id.to_string())
                    .join("project.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(disk["files"][0].get("text").is_none());
        assert_eq!(
            fs::read_to_string(storage.projects.file_path(project.id, project.files[0].id))
                .unwrap(),
            "# Unicode ☕"
        );
        fs::remove_file(&source).unwrap();
        let restored = storage.projects.list(&storage.history).unwrap();
        assert_eq!(restored[0].project.files[0].text, "# Unicode ☕");
        let mut excluded = restored.into_iter().next().unwrap().project;
        excluded.files[0].included = false;
        excluded.files[0].tokens = Some(4);
        excluded.files[0].token_source = Some("approximate".into());
        storage
            .projects
            .save(&storage.history, excluded, None)
            .unwrap();
        let restored = storage.projects.list(&storage.history).unwrap();
        assert!(!restored[0].project.files[0].included);
        assert_eq!(restored[0].project.files[0].tokens, Some(4));
    }

    #[test]
    fn removal_undo_keeps_later_edits_and_reclaims_expired_text() {
        let storage = Storage::new();
        let project = storage.create("Files");
        let source = storage.directory.path().join("source.txt");
        fs::write(&source, "The original is never changed.").unwrap();
        let added = storage
            .projects
            .add_file(&storage.history, project.id, &source, 4)
            .unwrap()
            .project
            .unwrap()
            .project;
        let file_id = added.files[0].id;
        let removed = storage
            .projects
            .remove_file(&storage.history, project.id, file_id)
            .unwrap();
        let token = removed.undo_token.unwrap();
        let mut edited = removed.project.unwrap().project;
        edited.instructions = "Later instructions".into();
        storage
            .projects
            .save(&storage.history, edited, None)
            .unwrap();
        let restored = storage
            .projects
            .undo(&storage.history, token, None)
            .unwrap()
            .project
            .unwrap()
            .project;
        assert_eq!(restored.instructions, "Later instructions");
        assert_eq!(restored.files[0].id, file_id);
        let removed = storage
            .projects
            .remove_file(&storage.history, project.id, file_id)
            .unwrap();
        storage
            .projects
            .undo
            .lock()
            .unwrap()
            .get_mut(&removed.undo_token.unwrap())
            .unwrap()
            .expires = Instant::now();
        assert!(storage
            .projects
            .undo(&storage.history, removed.undo_token.unwrap(), None)
            .is_err());
        assert!(!storage.projects.file_path(project.id, file_id).exists());
        assert_eq!(
            fs::read_to_string(source).unwrap(),
            "The original is never changed."
        );
    }

    #[test]
    fn move_remove_and_undo_preserve_custom_empty_and_inherited_prompts() {
        let storage = Storage::new();
        let first = storage.create("First");
        let second = storage.create("Second");
        for prompt in [None, Some(""), Some("My prompt")] {
            let chat = storage.chat(prompt);
            let moved = storage
                .projects
                .move_chat(&storage.history, chat.id, Some(first.id), None)
                .unwrap()
                .conversation
                .unwrap();
            assert_eq!(
                moved
                    .own_system_prompt
                    .as_ref()
                    .and_then(|value| value.as_deref()),
                prompt
            );
            storage
                .projects
                .move_chat(&storage.history, chat.id, Some(second.id), None)
                .unwrap();
            let removed = storage
                .projects
                .move_chat(&storage.history, chat.id, None, None)
                .unwrap();
            let mut current = removed.conversation.unwrap();
            assert_eq!(
                current.options.as_ref().unwrap().system_prompt.as_deref(),
                prompt
            );
            current.title = "A later title".into();
            storage.history.save(&current).unwrap();
            let restored = storage
                .projects
                .undo(&storage.history, removed.undo_token.unwrap(), None)
                .unwrap()
                .conversation
                .unwrap();
            assert_eq!(restored.title, "A later title");
            assert_eq!(restored.project_id, Some(second.id));
            assert_eq!(restored.options.unwrap().reasoning.as_deref(), Some("on"));
        }
    }

    #[test]
    fn archived_projects_guard_native_history_files_membership_and_deletion() {
        let storage = Storage::new();
        let mut project = storage.create("Archived");
        let chat = storage.chat(Some("Own"));
        let moved = storage
            .projects
            .move_chat(&storage.history, chat.id, Some(project.id), None)
            .unwrap()
            .conversation
            .unwrap();
        project.archived = true;
        let archived = storage
            .projects
            .save(&storage.history, project, None)
            .unwrap();
        let archived_project = archived.project.unwrap().project;
        assert!(storage.history.save(&moved).is_err());
        assert!(storage.history.delete(chat.id).is_err());
        assert!(storage
            .projects
            .move_chat(&storage.history, chat.id, None, None)
            .is_err());
        assert!(storage
            .projects
            .delete(&storage.history, archived_project.id, false, None)
            .is_err());
        assert!(storage
            .projects
            .remove_file(&storage.history, archived_project.id, Uuid::new_v4())
            .is_err());
        let source = storage.directory.path().join("notes.txt");
        fs::write(&source, "Text").unwrap();
        assert!(storage
            .projects
            .add_file(&storage.history, archived_project.id, &source, 4)
            .is_err());
        let mut invalid_edit = archived_project;
        invalid_edit.instructions = "Forbidden".into();
        invalid_edit.archived = false;
        assert!(storage
            .projects
            .save(&storage.history, invalid_edit, None)
            .is_err());
        storage
            .projects
            .undo(&storage.history, archived.undo_token.unwrap(), None)
            .unwrap();
        storage.history.save(&moved).unwrap();
    }

    #[test]
    fn delete_keeps_chats_by_default_and_optionally_deletes_stored_attachments() {
        for delete_chats in [false, true] {
            let storage = Storage::new();
            let project = storage.create("Delete");
            let chat = storage.chat(Some("Preserved own prompt"));
            let unrelated = storage.chat(None);
            let source = storage.directory.path().join("attachment.txt");
            fs::write(&source, "Original attachment").unwrap();
            storage.history.add_attachment(chat.id, &source).unwrap();
            storage
                .projects
                .move_chat(&storage.history, chat.id, Some(project.id), None)
                .unwrap();
            let result = storage
                .projects
                .delete(&storage.history, project.id, delete_chats, None)
                .unwrap();
            assert!(storage.projects.list(&storage.history).unwrap().is_empty());
            assert!(storage.history.read_one(unrelated.id).is_ok());
            if delete_chats {
                assert!(storage.history.read_one(chat.id).is_err());
                assert!(!storage.history.directory.join(chat.id.to_string()).exists());
                assert_eq!(result.deleted_conversation_ids.unwrap(), vec![chat.id]);
            } else {
                let detached = storage.history.read_one(chat.id).unwrap();
                assert_eq!(detached.project_id, None);
                assert_eq!(
                    detached.options.unwrap().system_prompt.as_deref(),
                    Some("Preserved own prompt")
                );
                assert_eq!(detached.attachments.len(), 1);
                assert_eq!(result.conversations.unwrap().len(), 1);
            }
            assert_eq!(fs::read_to_string(source).unwrap(), "Original attachment");
        }
    }

    #[test]
    fn committed_deletion_returns_saved_outcome_and_warning_when_cleanup_fails() {
        for delete_chats in [false, true] {
            let storage = Storage::new();
            let project = storage.create("Committed deletion");
            let chat = storage.chat(Some("Preserved own prompt"));
            storage
                .projects
                .move_chat(&storage.history, chat.id, Some(project.id), None)
                .unwrap();
            let result = storage
                .projects
                .delete_with_cleanup(
                    &storage.history,
                    project.id,
                    delete_chats,
                    None,
                    |directory| {
                        fs::remove_dir_all(directory.join("backups"))?;
                        Err(std::io::Error::new(
                            std::io::ErrorKind::PermissionDenied,
                            "simulated cleanup failure",
                        ))
                    },
                )
                .unwrap();
            let json = serde_json::to_value(&result).unwrap();
            assert!(json["warning"]
                .as_str()
                .unwrap()
                .contains("deletion was saved"));
            assert!(result
                .warning
                .as_deref()
                .unwrap()
                .contains("simulated cleanup failure"));
            assert!(!storage
                .projects
                .directory
                .join(project.id.to_string())
                .exists());
            if delete_chats {
                assert_eq!(result.deleted_conversation_ids.unwrap(), vec![chat.id]);
                assert!(result.conversations.unwrap().is_empty());
            } else {
                let affected = result.conversations.unwrap();
                assert_eq!(affected[0].id, chat.id);
                assert!(affected[0].project_id.is_none());
                assert_eq!(
                    affected[0]
                        .options
                        .as_ref()
                        .unwrap()
                        .system_prompt
                        .as_deref(),
                    Some("Preserved own prompt")
                );
                assert!(result.deleted_conversation_ids.unwrap().is_empty());
            }
            let transactions = storage.projects.directory.join(".transactions");
            assert_eq!(fs::read_dir(&transactions).unwrap().count(), 1);
            let current = storage.history.list().unwrap();
            assert_eq!(current.len(), usize::from(!delete_chats));
            assert_eq!(fs::read_dir(transactions).unwrap().count(), 0);
        }
    }

    #[test]
    fn recovery_rolls_back_partial_multirecord_deletion_byte_for_byte() {
        let storage = Storage::new();
        let project = storage.create("Recovery");
        let chat = storage.chat(Some("Prompt"));
        let attached = storage
            .projects
            .move_chat(&storage.history, chat.id, Some(project.id), None)
            .unwrap()
            .conversation
            .unwrap();
        let path = storage.history.directory.join(format!("{}.json", chat.id));
        let original = fs::read(&path).unwrap();
        let stage = storage
            .projects
            .directory
            .join(".transactions")
            .join(Uuid::new_v4().to_string());
        private_directory(&stage.join("backups")).unwrap();
        fs::copy(
            &path,
            stage.join("backups").join(format!("{}.json", chat.id)),
        )
        .unwrap();
        write_json(
            &stage.join("operation.json"),
            &DeleteJournal {
                project_id: project.id,
                conversations: vec![chat.id],
                delete_chats: false,
                committed: false,
                rolled_back: false,
            },
        )
        .unwrap();
        let mut detached = attached;
        change_membership(&mut detached, None);
        storage.history.write(&detached, false).unwrap();
        fs::rename(
            storage.projects.directory.join(project.id.to_string()),
            stage.join("project"),
        )
        .unwrap();
        let recovered = storage.history.list().unwrap();
        assert_eq!(recovered[0].project_id, Some(project.id));
        assert_eq!(fs::read(path).unwrap(), original);
        assert!(storage.projects.list(&storage.history).is_ok());
        assert!(!stage.exists());
    }

    #[test]
    fn recovery_finishes_rollback_cleanup_without_replaying_reclaimed_backups() {
        let storage = Storage::new();
        let project = storage.create("Completed rollback");
        let chat = storage.chat(Some("Keep this prompt"));
        storage
            .projects
            .move_chat(&storage.history, chat.id, Some(project.id), None)
            .unwrap();
        let path = storage.history.directory.join(format!("{}.json", chat.id));
        let original = fs::read(&path).unwrap();
        let stage = storage
            .projects
            .directory
            .join(".transactions")
            .join(Uuid::new_v4().to_string());
        private_directory(&stage).unwrap();
        // Recovery previously restored all records, then cleanup reclaimed a
        // backup before failing. Only the completion marker must be consulted.
        write_json(
            &stage.join("operation.json"),
            &DeleteJournal {
                project_id: project.id,
                conversations: vec![chat.id],
                delete_chats: true,
                committed: false,
                rolled_back: true,
            },
        )
        .unwrap();
        assert!(!stage.join("backups").exists());
        let loaded = storage.history.list().unwrap();
        assert_eq!(loaded[0].project_id, Some(project.id));
        assert_eq!(fs::read(path).unwrap(), original);
        assert!(!stage.exists());
    }

    #[test]
    fn identifiers_and_failed_writes_preserve_valid_records() {
        let storage = Storage::new();
        let project = storage.create("Safe");
        let record = storage
            .projects
            .directory
            .join(project.id.to_string())
            .join("project.json");
        let previous = fs::read(&record).unwrap();
        let mut invalid = project.clone();
        invalid.instructions.push('\0');
        assert!(storage
            .projects
            .save(&storage.history, invalid, None)
            .is_err());
        assert_eq!(fs::read(&record).unwrap(), previous);
        let mut json = serde_json::to_value(&project).unwrap();
        json["id"] = serde_json::json!("../escape");
        assert!(serde_json::from_value::<Project>(json).is_err());
        fs::create_dir(storage.projects.directory.join("invalid-id")).unwrap();
        assert!(storage.projects.list(&storage.history).is_err());
        fs::remove_dir(storage.projects.directory.join("invalid-id")).unwrap();
        let source = storage.directory.path().join("notes.txt");
        fs::write(&source, "Source survives failed storage").unwrap();
        fs::write(
            storage
                .projects
                .directory
                .join(project.id.to_string())
                .join("files"),
            "blocked",
        )
        .unwrap();
        assert!(storage
            .projects
            .add_file(&storage.history, project.id, &source, 4)
            .is_err());
        assert_eq!(fs::read(&record).unwrap(), previous);
        assert_eq!(
            fs::read_to_string(source).unwrap(),
            "Source survives failed storage"
        );
    }

    #[test]
    fn removal_undo_keeps_original_relative_order_after_later_file_changes() {
        let storage = Storage::new();
        let project = storage.create("Order");
        let mut ids = Vec::new();
        for name in ["a.txt", "b.txt", "c.txt"] {
            let path = storage.directory.path().join(name);
            fs::write(&path, name).unwrap();
            let added = storage
                .projects
                .add_file(&storage.history, project.id, &path, 4)
                .unwrap()
                .project
                .unwrap()
                .project;
            ids.push(added.files.last().unwrap().id);
        }
        let removed_b = storage
            .projects
            .remove_file(&storage.history, project.id, ids[1])
            .unwrap();
        storage
            .projects
            .remove_file(&storage.history, project.id, ids[0])
            .unwrap();
        let restored = storage
            .projects
            .undo(&storage.history, removed_b.undo_token.unwrap(), None)
            .unwrap()
            .project
            .unwrap()
            .project;
        assert_eq!(
            restored
                .files
                .iter()
                .map(|file| file.id)
                .collect::<Vec<_>>(),
            vec![ids[1], ids[2]]
        );
    }

    #[test]
    fn reopening_reclaims_unreferenced_text_after_session_local_undo_is_lost() {
        let storage = Storage::new();
        let project = storage.create("Session cleanup");
        let source = storage.directory.path().join("source.txt");
        fs::write(&source, "Keep the original").unwrap();
        let added = storage
            .projects
            .add_file(&storage.history, project.id, &source, 4)
            .unwrap()
            .project
            .unwrap()
            .project;
        let path = storage.projects.file_path(project.id, added.files[0].id);
        storage
            .projects
            .remove_file(&storage.history, project.id, added.files[0].id)
            .unwrap();
        assert!(path.exists());
        let reopened = Projects::new(storage.projects.directory.clone(), &storage.history).unwrap();
        assert!(reopened.list(&storage.history).unwrap()[0]
            .project
            .files
            .is_empty());
        assert!(!path.exists());
        assert_eq!(fs::read_to_string(source).unwrap(), "Keep the original");
    }

    #[test]
    fn explicit_null_own_prompt_is_distinct_from_legacy_absence() {
        let storage = Storage::new();
        let project = storage.create("Prompt inheritance");
        let legacy = storage.chat(Some("Legacy custom prompt"));
        let mut value = serde_json::to_value(&legacy).unwrap();
        value["ownSystemPrompt"] = serde_json::Value::Null;
        let explicit: Conversation = serde_json::from_value(value).unwrap();
        assert_eq!(explicit.own_system_prompt, Some(None));
        storage.history.save(&explicit).unwrap();
        let moved = storage
            .projects
            .move_chat(&storage.history, explicit.id, Some(project.id), None)
            .unwrap()
            .conversation
            .unwrap();
        let serialized = serde_json::to_value(&moved).unwrap();
        assert!(serialized
            .get("ownSystemPrompt")
            .is_some_and(serde_json::Value::is_null));
        let removed = storage
            .projects
            .move_chat(&storage.history, explicit.id, None, None)
            .unwrap()
            .conversation
            .unwrap();
        assert!(removed.options.unwrap().system_prompt.is_none());
    }

    #[test]
    fn simultaneous_creation_serializes_case_insensitive_uniqueness() {
        let storage = Storage::new();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| {
                storage
                    .projects
                    .save(&storage.history, project("Shared"), None)
                    .is_ok()
            });
            let second = scope.spawn(|| {
                storage
                    .projects
                    .save(&storage.history, project("SHARED"), None)
                    .is_ok()
            });
            assert_ne!(first.join().unwrap(), second.join().unwrap());
        });
        assert_eq!(storage.projects.list(&storage.history).unwrap().len(), 1);
    }

    #[test]
    fn interrupted_chat_deletion_restores_original_attachments_before_listing_history() {
        let storage = Storage::new();
        let project = storage.create("Recover attachments");
        let chat = storage.chat(None);
        let source = storage.directory.path().join("original.txt");
        fs::write(&source, "Attachment that must survive a crash").unwrap();
        storage.history.add_attachment(chat.id, &source).unwrap();
        storage
            .projects
            .move_chat(&storage.history, chat.id, Some(project.id), None)
            .unwrap();
        let record = storage.history.directory.join(format!("{}.json", chat.id));
        let original = fs::read(&record).unwrap();
        let stage = storage
            .projects
            .directory
            .join(".transactions")
            .join(Uuid::new_v4().to_string());
        private_directory(&stage.join("backups")).unwrap();
        private_directory(&stage.join("removed")).unwrap();
        fs::copy(
            &record,
            stage.join("backups").join(format!("{}.json", chat.id)),
        )
        .unwrap();
        write_json(
            &stage.join("operation.json"),
            &DeleteJournal {
                project_id: project.id,
                conversations: vec![chat.id],
                delete_chats: true,
                committed: false,
                rolled_back: false,
            },
        )
        .unwrap();
        fs::rename(
            &record,
            stage.join("removed").join(format!("{}.json", chat.id)),
        )
        .unwrap();
        fs::rename(
            storage.history.directory.join(chat.id.to_string()),
            stage.join("removed").join(chat.id.to_string()),
        )
        .unwrap();
        fs::rename(
            storage.projects.directory.join(project.id.to_string()),
            stage.join("project"),
        )
        .unwrap();
        let recovered = storage.history.list().unwrap();
        assert_eq!(recovered[0].attachments.len(), 1);
        assert_eq!(fs::read(record).unwrap(), original);
        let destination = storage.directory.path().join("download.txt");
        storage
            .history
            .download_attachment(chat.id, recovered[0].attachments[0].id, &destination)
            .unwrap();
        assert_eq!(
            fs::read_to_string(destination).unwrap(),
            "Attachment that must survive a crash"
        );
        assert_eq!(
            fs::read_to_string(source).unwrap(),
            "Attachment that must survive a crash"
        );
    }

    #[test]
    fn generation_guards_only_the_active_chat_and_project_lifecycle() {
        let storage = Storage::new();
        let mut project = storage.create("Active");
        let active = storage.chat(None);
        let other = storage.chat(None);
        storage
            .projects
            .move_chat(&storage.history, active.id, Some(project.id), None)
            .unwrap();
        storage
            .projects
            .move_chat(&storage.history, other.id, Some(project.id), None)
            .unwrap();
        project.instructions = "Next request only".into();
        let edited = storage
            .projects
            .save(&storage.history, project, Some(active.id))
            .unwrap()
            .project
            .unwrap()
            .project;
        let mut archive = edited.clone();
        archive.archived = true;
        assert!(storage
            .projects
            .save(&storage.history, archive, Some(active.id))
            .is_err());
        assert!(storage
            .projects
            .delete(&storage.history, edited.id, false, Some(active.id))
            .is_err());
        assert!(storage
            .projects
            .move_chat(&storage.history, active.id, None, Some(active.id))
            .is_err());
        storage
            .projects
            .move_chat(&storage.history, other.id, None, Some(active.id))
            .unwrap();
        assert_eq!(
            storage.projects.list(&storage.history).unwrap()[0]
                .project
                .instructions,
            "Next request only"
        );
    }
}
