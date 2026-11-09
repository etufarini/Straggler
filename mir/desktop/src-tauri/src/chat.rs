use crate::{stream, ChatMessage, ChatRequest, Result, Runtime};
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
        if request.messages.is_empty()
            || request
                .messages
                .iter()
                .any(|m| !matches!(m.role.as_str(), "system" | "user" | "assistant"))
        {
            return Err("A chat request needs valid messages.".into());
        }
        let token = CancellationToken::new();
        let url = {
            let mut active = self.active.lock().map_err(|e| e.to_string())?;
            if active.cancelled == Some(request.request_id) {
                active.cancelled = None;
                return Ok("stopped".into());
            }
            if active.current.is_some() {
                return Err("A response is already being generated.".into());
            }
            let state = self.server.lock().map_err(|e| e.to_string())?;
            if state.phase != "ready" {
                return Err("Wait until the local model is Ready.".into());
            }
            let url = state
                .url
                .clone()
                .ok_or("The server address is unavailable.")?;
            active.current = Some((request.request_id, token.clone()));
            url
        };
        let result = tokio::select! {
            _ = token.cancelled() => Ok("stopped".into()),
            result = self.receive(&url, &request.messages, &mut emit) => result,
        };
        self.active.lock().map_err(|e| e.to_string())?.current = None;
        result
    }

    async fn receive(
        &self,
        url: &str,
        messages: &[ChatMessage],
        emit: &mut impl FnMut(stream::Delta) -> Result<()>,
    ) -> Result<String> {
        let response = self
            .client
            .post(format!("{url}/v1/chat/completions"))
            .json(&json!({"messages": messages, "stream": true}))
            .send()
            .await
            .map_err(|e| format!("Cannot contact the local model: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
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
                .and_then(|v| v["error"]["message"].as_str().map(str::to_owned))
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
                if !delta.content.is_empty() || !delta.reasoning.is_empty() {
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
