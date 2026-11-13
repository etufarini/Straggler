use crate::{Result, Runtime};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerDetails {
    pub run_id: Uuid,
    pub context_size: Option<u64>,
    pub reasoning_supported: Option<bool>,
    pub effort_levels: Vec<String>,
    pub system_role_supported: Option<bool>,
    pub error: Option<String>,
}

impl Runtime {
    pub async fn server_details(&self) -> Result<ServerDetails> {
        let (run, url) = {
            let server = self.server.lock().map_err(|e| e.to_string())?;
            if server.phase != "ready" || server.child.is_none() {
                return Err("Model capabilities are available after the server is ready.".into());
            }
            (
                server.run,
                server
                    .url
                    .clone()
                    .ok_or("The server address is unavailable.")?,
            )
        };
        if let Some(cached) = self
            .model_details
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
        {
            if cached.run_id == run && cached.error.is_none() {
                return Ok(cached.clone());
            }
        }
        let mut details = ServerDetails {
            run_id: run,
            context_size: None,
            reasoning_supported: None,
            effort_levels: Vec::new(),
            system_role_supported: None,
            error: None,
        };
        match self.read_model_details(&url, &mut details).await {
            Ok(()) => {}
            Err(error) => details.error = Some(error),
        }
        let server = self.server.lock().map_err(|e| e.to_string())?;
        if server.run != run || server.phase != "ready" {
            return Err("The server changed while reading model capabilities.".into());
        }
        *self.model_details.lock().map_err(|e| e.to_string())? = Some(details.clone());
        Ok(details)
    }

    async fn read_model_details(&self, url: &str, details: &mut ServerDetails) -> Result<()> {
        let props: Value = self
            .client
            .get(format!("{url}/props"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| format!("Model properties are unavailable: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Invalid model properties: {e}"))?;
        details.context_size = props["default_generation_settings"]["n_ctx"]
            .as_u64()
            .filter(|&n| n > 0);
        let capabilities = &props["chat_template_caps"];
        details.system_role_supported = capabilities["supports_system_role"].as_bool();
        details.effort_levels = capabilities["reasoning_effort_levels"]
            .as_array()
            .map(|levels| {
                levels
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|value| {
                        valid_effort(value) && !matches!(*value, "none" | "auto" | "default")
                    })
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        details.effort_levels.dedup();
        // Ask the server to render its actual template, without inference. Different
        // prompts establish that this template honors the request-time switch.
        // Missing/failed probes remain unknown; no model-name heuristics are used.
        let (on, off) = tokio::join!(
            self.render_reasoning_probe(url, true),
            self.render_reasoning_probe(url, false)
        );
        if let (Ok(on), Ok(off)) = (on, off) {
            if on != off {
                details.reasoning_supported = Some(true);
            } else if details.effort_levels.is_empty() {
                details.reasoning_supported = Some(false);
            }
        }
        if !details.effort_levels.is_empty() {
            details.reasoning_supported = Some(true);
        }
        Ok(())
    }

    async fn render_reasoning_probe(&self, url: &str, enabled: bool) -> Result<String> {
        let mut body = json!({
            "messages": [{"role": "user", "content": "Capability check."}],
            "chat_template_kwargs": {"enable_thinking": enabled},
        });
        if !enabled {
            body["reasoning_effort"] = json!("none");
        }
        let response: Value = self
            .client
            .post(format!("{url}/apply-template"))
            .timeout(Duration::from_secs(3))
            .json(&body)
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        response["prompt"]
            .as_str()
            .map(str::to_owned)
            .ok_or("Template rendering is unavailable.".into())
    }
}

pub fn valid_effort(value: &str) -> bool {
    value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value.len() <= 32
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}
