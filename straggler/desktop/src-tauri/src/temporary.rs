//! Temporary conversations own only memory until an explicit Save chat operation.

use crate::{
    attachments::{self, ExtractedFile},
    history::Conversation,
    Result, Runtime,
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, time::Duration};
use uuid::Uuid;

pub(crate) struct TemporaryChat {
    pub id: Uuid,
    pub slot: Option<(Uuid, u64)>,
    pub originals: BTreeMap<Uuid, ExtractedFile>,
    pub resume_model: Option<String>,
    pub ending: bool,
}

impl Runtime {
    pub fn begin_temporary(&self, id: Uuid) -> Result<()> {
        if id.is_nil() || self.history.directory.join(format!("{id}.json")).exists() {
            return Err("Choose a new identifier for temporary chat.".into());
        }
        if self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .current
            .is_some()
        {
            return Err("Stop the response before opening a temporary chat.".into());
        }
        if self.temporary.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Leave or save the current temporary chat first.".into());
        }
        let model = {
            let server = self.server.lock().map_err(|e| e.to_string())?;
            server.child.as_ref().and(server.model.clone())
        };
        if model.is_some() {
            self.native.temporary_arguments()?;
            self.stop()?;
        }
        *self.temporary.lock().map_err(|e| e.to_string())? = Some(TemporaryChat {
            id,
            slot: None,
            originals: BTreeMap::new(),
            resume_model: model.clone(),
            ending: false,
        });
        if let Some(model) = model {
            if let Err(error) = self.start(model.clone()) {
                *self.temporary.lock().map_err(|e| e.to_string())? = None;
                let restored = self.start(model).err();
                return Err(match restored {
                    Some(restore) => format!("Cannot prepare temporary chat: {error}. Cannot restore the server: {restore}"),
                    None => format!("Cannot prepare temporary chat: {error}"),
                });
            }
        }
        Ok(())
    }

    pub fn ensure_persistent(&self, id: Uuid) -> Result<()> {
        if self
            .temporary
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .is_some_and(|chat| chat.id == id)
        {
            return Err("Temporary chats can only be stored with Save chat.".into());
        }
        Ok(())
    }

    pub fn temporary_attachment(&self, id: Uuid, path: &Path) -> Result<attachments::Attachment> {
        let file = attachments::extract(path)?;
        let mut session = self.temporary.lock().map_err(|e| e.to_string())?;
        let chat = session
            .as_mut()
            .filter(|chat| chat.id == id && !chat.ending)
            .ok_or("The temporary chat is no longer available.")?;
        // Bound original bytes retained in memory independently of frontend limits.
        if chat
            .originals
            .values()
            .map(|file| file.original.len() as u64)
            .sum::<u64>()
            + file.original.len() as u64
            > 100 * 1024 * 1024
        {
            return Err("Temporary attachments exceed the 100 MB memory limit.".into());
        }
        let attachment = file.attachment.clone();
        chat.originals.insert(attachment.id, file);
        Ok(attachment)
    }

    pub fn remove_temporary_attachment(&self, id: Uuid, attachment: Uuid) -> Result<()> {
        let mut session = self.temporary.lock().map_err(|e| e.to_string())?;
        let chat = session
            .as_mut()
            .filter(|chat| chat.id == id && !chat.ending)
            .ok_or("The temporary chat is no longer available.")?;
        chat.originals
            .remove(&attachment)
            .ok_or("This attachment is no longer available.")?;
        Ok(())
    }

    pub fn validate_temporary_request(
        &self,
        temporary: Option<Uuid>,
        conversation: Option<Uuid>,
    ) -> Result<()> {
        let session = self.temporary.lock().map_err(|e| e.to_string())?;
        match (temporary, session.as_ref()) {
            (Some(id), Some(chat)) if id == chat.id && !chat.ending && conversation.is_none() => {
                Ok(())
            }
            (None, None) => Ok(()),
            _ => Err("The request does not belong to the current chat mode.".into()),
        }
    }

    pub async fn temporary_slot(&self, id: Uuid, url: &str, run: Uuid) -> Result<u64> {
        {
            let session = self.temporary.lock().map_err(|e| e.to_string())?;
            let chat = session
                .as_ref()
                .filter(|chat| chat.id == id && !chat.ending)
                .ok_or("The temporary chat is no longer available.")?;
            if let Some((owner, slot)) = chat.slot {
                if owner == run {
                    return Ok(slot);
                }
            }
        }
        let slots: Value = self
            .client
            .get(format!("{url}/slots"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|_| "This backend cannot provide a slot for temporary chat.")?
            .json()
            .await
            .map_err(|_| "The backend returned invalid temporary slot information.")?;
        let slot = slots
            .as_array()
            .and_then(|slots| {
                slots.iter().find_map(|slot| {
                    (slot["is_processing"] == false)
                        .then(|| slot["id"].as_u64())
                        .flatten()
                })
            })
            .ok_or("No idle backend slot is available for temporary chat.")?;
        let mut session = self.temporary.lock().map_err(|e| e.to_string())?;
        let chat = session
            .as_mut()
            .filter(|chat| chat.id == id && !chat.ending)
            .ok_or("The temporary chat is no longer available.")?;
        chat.slot = Some((run, slot));
        Ok(slot)
    }

    pub async fn erase_temporary_slot(&self, id: Uuid) -> Result<()> {
        let slot = {
            let mut session = self.temporary.lock().map_err(|e| e.to_string())?;
            let chat = session
                .as_mut()
                .filter(|chat| chat.id == id)
                .ok_or("The temporary chat is no longer available.")?;
            chat.ending = true;
            chat.slot
        };
        let Some((owner, slot)) = slot else {
            return Ok(());
        };
        let url = {
            let server = self.server.lock().map_err(|e| e.to_string())?;
            if server.run != owner || server.child.is_none() {
                return Ok(());
            }
            server
                .url
                .clone()
                .ok_or("The temporary backend address is unavailable.")?
        };
        // Cancellation closes the stream before the backend necessarily releases its slot.
        for _ in 0..10 {
            let response = self
                .client
                .post(format!("{url}/slots/{slot}?action=erase"))
                .timeout(Duration::from_secs(1))
                .json(&json!({}))
                .send()
                .await;
            if let Ok(response) = response {
                if response.status().is_success() {
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("The backend did not confirm slot erasure; its process must be stopped.".into())
    }

    /// Called after attempting slot erasure. Stopping the owned process also drops all RAM caches.
    pub fn finish_temporary(
        &self,
        id: Uuid,
        save: Option<Conversation>,
        restart: bool,
    ) -> Result<Option<String>> {
        if self
            .temporary
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .is_none_or(|chat| chat.id != id)
        {
            return Err("The temporary chat is no longer available.".into());
        }
        if self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .current
            .is_some()
        {
            return Err("Wait for the temporary response to stop before leaving.".into());
        }
        self.stop()?;
        let mut session = self.temporary.lock().map_err(|e| e.to_string())?;
        let chat = session
            .as_mut()
            .filter(|chat| chat.id == id)
            .ok_or("The temporary chat is no longer available.")?;
        self.web_search.clear_cache()?;
        *self.attachment_index.lock().map_err(|e| e.to_string())? = Default::default();
        if let Some(conversation) = save {
            if conversation.id != id || conversation.project_id.is_some() {
                return Err("A temporary chat must be saved outside projects.".into());
            }
            if let Err(error) = self
                .history
                .create_with_originals(&conversation, &chat.originals)
            {
                chat.ending = false;
                return Err(error);
            }
        }
        let model = chat.resume_model.clone();
        *session = None;
        drop(session);
        if restart {
            if let Some(model) = model {
                if let Err(error) = self.start(model) {
                    return Ok(Some(format!(
                        "Chat cleanup completed. The server could not restart: {error}"
                    )));
                }
            }
        }
        Ok(None)
    }
}
