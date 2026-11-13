use crate::{ChatMessage, Result, Runtime};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTokens {
    pub tokens: usize,
    pub templated: bool,
}

impl Runtime {
    fn token_server(&self) -> Result<(Uuid, String)> {
        let server = self.server.lock().map_err(|e| e.to_string())?;
        if server.phase != "ready" {
            return Err("Tokenization is available when the server is ready.".into());
        }
        Ok((
            server.run,
            server
                .url
                .clone()
                .ok_or("The server address is unavailable.")?,
        ))
    }

    async fn tokenize_at(
        &self,
        run: Uuid,
        url: &str,
        content: &str,
        parse_special: bool,
    ) -> Result<usize> {
        let response: Value = self.client.post(format!("{url}/tokenize"))
            .timeout(Duration::from_secs(3))
            .json(&json!({"content": content, "add_special": false, "parse_special": parse_special, "with_pieces": false}))
            .send().await.and_then(|response| response.error_for_status())
            .map_err(|e| format!("Server tokenization is unavailable: {e}"))?
            .json().await.map_err(|e| format!("Invalid tokenization response: {e}"))?;
        let tokens = response
            .get("tokens")
            .and_then(Value::as_array)
            .ok_or("The server did not return token IDs.")?
            .len();
        let server = self.server.lock().map_err(|e| e.to_string())?;
        if server.run != run || server.phase != "ready" {
            return Err("The server changed while counting tokens.".into());
        }
        Ok(tokens)
    }

    pub async fn tokenize_text(&self, content: &str) -> Result<usize> {
        let (run, url) = self.token_server()?;
        self.tokenize_at(run, &url, content, false).await
    }

    pub async fn prompt_tokens(&self, messages: Vec<ChatMessage>) -> Result<PromptTokens> {
        let (run, url) = self.token_server()?;
        let template = self
            .client
            .post(format!("{url}/apply-template"))
            .timeout(Duration::from_secs(3))
            .json(&json!({"messages": messages}))
            .send()
            .await
            .and_then(|response| response.error_for_status());
        let rendered: Option<Value> = match template {
            Ok(response) => response.json().await.ok(),
            Err(_) => None,
        };
        let prompt = rendered
            .as_ref()
            .and_then(|value| value.get("prompt"))
            .and_then(Value::as_str);
        let fallback = messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let tokens = self
            .tokenize_at(run, &url, prompt.unwrap_or(&fallback), prompt.is_some())
            .await?;
        Ok(PromptTokens {
            tokens,
            templated: prompt.is_some(),
        })
    }
}
