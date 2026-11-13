use crate::{stream, ChatRequest, Result, Runtime};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

impl Runtime {
    pub fn cancel(&self, id: Uuid) -> Result<()> {
        let mut generation = self.active.lock().map_err(|e| e.to_string())?;
        if let Some((active, token)) = generation.current.as_ref() {
            if *active == id {
                token.cancel();
            }
        }
        // Cancellation may arrive before the async generate command is polled.
        generation.cancelled = Some(id);
        Ok(())
    }

    pub async fn generate(
        &self,
        request: ChatRequest,
        mut emit: impl FnMut(stream::Delta) -> Result<()>,
    ) -> Result<String> {
        self.validate_temporary_request(request.temporary_id, request.conversation_id)?;
        if request.messages.is_empty()
            || request
                .messages
                .iter()
                .any(|m| !matches!(m.role.as_str(), "system" | "user" | "assistant"))
        {
            return Err("A chat request needs valid messages.".into());
        }
        let token = CancellationToken::new();
        let (url, run, failed) = {
            let mut active = self.active.lock().map_err(|e| e.to_string())?;
            if active.cancelled == Some(request.request_id) {
                active.cancelled = None;
                return Ok("stopped".into());
            }
            if active.current.is_some() {
                return Err("A response is already being generated.".into());
            }
            if let Some(id) = request.conversation_id {
                let _guard = self
                    .history
                    .writer
                    .lock()
                    .map_err(|error| error.to_string())?;
                self.history.recover()?;
                let conversation = self.history.read_one(id)?;
                if let Some(project) = conversation.project_id {
                    crate::projects::ensure_active_at(&self.history.project_directory()?, project)?;
                }
            }
            let state = self.server.lock().map_err(|e| e.to_string())?;
            if state.diagnostics.issue.is_some() {
                return Err(
                    "The local server needs to be restarted before another request.".into(),
                );
            }
            if state.phase != "ready" {
                return Err("Wait until the local model is Ready.".into());
            }
            if request.temporary_id.is_some() && !state.temporary {
                return Err("Restart the backend in temporary mode before sending.".into());
            }
            let url = state
                .url
                .clone()
                .ok_or("The server address is unavailable.")?;
            active.current = Some((request.request_id, token.clone()));
            active.conversation_id = request.conversation_id;
            (url, state.run, state.diagnostics.failed.clone())
        };
        let result = tokio::select! {
            biased;
            _ = failed.cancelled() => Err("The inference backend cannot continue. Check the server log and restart it.".into()),
            _ = token.cancelled() => Ok("stopped".into()),
            result = self.receive(&url, &request, &mut emit) => result,
        };
        let mut state = self.server.lock().map_err(|e| e.to_string())?;
        if state.run == run {
            match &result {
                Err(detail) => state.diagnostics.request_failed(detail),
                Ok(status) if matches!(status.as_str(), "complete" | "length") => {
                    state.diagnostics.request_succeeded()
                }
                _ => {}
            }
        }
        drop(state);
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        active.current = None;
        active.conversation_id = None;
        result
    }

    async fn receive(
        &self,
        url: &str,
        request: &ChatRequest,
        emit: &mut impl FnMut(stream::Delta) -> Result<()>,
    ) -> Result<String> {
        let mut body = json!({
            "messages": request.messages,
            "stream": true,
            "stream_options": {"include_usage": true},
            "timings_per_token": true,
        });
        if let Some(id) = request.temporary_id {
            let run = self.server.lock().map_err(|e| e.to_string())?.run;
            body["id_slot"] = json!(self.temporary_slot(id, url, run).await?);
            body["cache_prompt"] = json!(false);
        }
        let reasoning = request.options.reasoning.as_deref().unwrap_or("auto");
        let effort = request.options.effort.as_deref().unwrap_or("auto");
        if !matches!(reasoning, "auto" | "on" | "off") {
            return Err("Reasoning must use the model default, on or off.".into());
        }
        let has_system_prompt = request.messages.iter().any(|m| m.role == "system");
        if reasoning != "auto" || effort != "auto" || has_system_prompt {
            let details = self.server_details().await?;
            if has_system_prompt && details.system_role_supported == Some(false) {
                return Err("The loaded chat template does not support a system prompt.".into());
            }
            if reasoning != "auto" && details.reasoning_supported != Some(true) {
                return Err(
                    "Reasoning controls are unavailable for this server and chat template.".into(),
                );
            }
            if reasoning != "off"
                && effort != "auto"
                && !details.effort_levels.iter().any(|level| level == effort)
            {
                return Err("The selected reasoning effort is not advertised by the loaded chat template. Choose its default or a supported level.".into());
            }
        }
        if reasoning != "auto" {
            body["chat_template_kwargs"] = json!({"enable_thinking": reasoning == "on"});
        }
        if reasoning == "off" {
            body["reasoning_effort"] = json!("none");
        } else if effort != "auto" {
            body["reasoning_effort"] = json!(effort);
        }
        let response = self
            .client
            .post(format!("{url}/v1/chat/completions"))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Cannot contact the local model: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            if request.temporary_id.is_some() {
                return Err(format!("Temporary model request failed ({status}). The backend did not accept the request."));
            }
            let mut bytes = response.bytes_stream();
            let mut body = Vec::new();
            while let Some(chunk) = bytes.next().await {
                let chunk = chunk.map_err(|e| e.to_string())?;
                body.extend_from_slice(&chunk[..chunk.len().min(16384 - body.len())]);
                if body.len() == 16384 {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&body);
            let detail = serde_json::from_slice::<Value>(&body)
                .ok()
                .and_then(|value| {
                    value["error"]["message"].as_str().map(|message| {
                        if value["error"]["type"] == "exceed_context_size_error" {
                            format!("exceed_context_size_error: {message}")
                        } else {
                            message.to_owned()
                        }
                    })
                })
                .unwrap_or_else(|| text.into_owned());
            return Err(format!("Model request failed ({status}): {detail}"));
        }
        let mut bytes = response.bytes_stream();
        let mut decoder = stream::Decoder::default();
        let mut finish = None;
        while let Some(chunk) = bytes.next().await {
            for data in decoder.push(&chunk.map_err(|e| format!("Response interrupted: {e}"))?)? {
                if data == "[DONE]" {
                    return Ok(if finish.as_deref() == Some("length") {
                        "length"
                    } else {
                        "complete"
                    }
                    .into());
                }
                let (delta, reason) = stream::parse(&data)?;
                if !delta.content.is_empty()
                    || !delta.reasoning.is_empty()
                    || delta.metrics.is_some()
                {
                    emit(delta)?;
                }
                if reason.is_some() {
                    finish = reason;
                }
            }
        }
        match finish.as_deref() {
            Some("length") => Ok("length".into()),
            Some(_) => Ok("complete".into()),
            None => Err(
                "The response ended unexpectedly. Partial text was kept; check the server log."
                    .into(),
            ),
        }
    }
}
