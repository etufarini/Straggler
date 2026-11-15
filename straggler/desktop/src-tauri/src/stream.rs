use crate::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationMetrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_second: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<uuid::Uuid>,
}

impl GenerationMetrics {
    pub fn merge(&mut self, newer: &Self) {
        fn update<T: Clone>(value: &mut Option<T>, newer: &Option<T>) {
            if newer.is_some() {
                value.clone_from(newer);
            }
        }
        update(&mut self.context_tokens, &newer.context_tokens);
        update(&mut self.context_source, &newer.context_source);
        update(&mut self.output_tokens, &newer.output_tokens);
        update(&mut self.tokens_per_second, &newer.tokens_per_second);
        update(&mut self.generation_ms, &newer.generation_ms);
        update(&mut self.prompt_ms, &newer.prompt_ms);
        update(&mut self.run_id, &newer.run_id);
    }
}

fn metrics(event: &Value) -> Option<GenerationMetrics> {
    let timings = &event["timings"];
    let usage = &event["usage"];
    let number = |key: &str| timings[key].as_f64().filter(|n| n.is_finite() && *n >= 0.0);
    let timing_tokens = timings["cache_n"]
        .as_u64()
        .zip(timings["prompt_n"].as_u64())
        .and_then(|(cached, prompt)| cached.checked_add(prompt))
        .zip(timings["predicted_n"].as_u64())
        .and_then(|(prompt, output)| prompt.checked_add(output));
    let usage_tokens = usage["total_tokens"].as_u64();
    if !timings.is_object() && !usage.is_object() {
        return None;
    }
    Some(GenerationMetrics {
        context_tokens: usage_tokens.or(timing_tokens),
        context_source: if usage_tokens.is_some() {
            Some("usage".into())
        } else {
            timing_tokens.map(|_| "timings".into())
        },
        output_tokens: usage["completion_tokens"]
            .as_u64()
            .or(timings["predicted_n"].as_u64()),
        tokens_per_second: number("predicted_per_second"),
        generation_ms: number("predicted_ms"),
        prompt_ms: number("prompt_ms"),
        run_id: None,
    })
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Delta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<crate::web_search::citations::Source>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "webSearch")]
    pub web_search: Option<crate::web_search::turn::TurnSummary>,
    #[serde(skip)]
    pub web_events: Vec<crate::web_search::turn::WebEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<GenerationMetrics>,
    pub content: String,
    pub reasoning: String,
}

// Keep bytes until a complete SSE line arrives, including split UTF-8 codepoints.
#[derive(Default)]
pub struct Decoder {
    buffer: Vec<u8>,
    data: Vec<String>,
    event_bytes: usize,
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(end) = self.buffer.iter().position(|&b| b == b'\n') {
            let line = self.buffer.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line)
                .map_err(|e| format!("Invalid stream text: {e}"))?
                .trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    events.push(self.data.join("\n"));
                    self.data.clear();
                    self.event_bytes = 0;
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.event_bytes += data.len();
                if self.event_bytes > 2 * 1024 * 1024 {
                    return Err("Server stream event is too large.".into());
                }
                self.data
                    .push(data.strip_prefix(' ').unwrap_or(data).to_owned());
            }
        }
        if self.buffer.len() > 2 * 1024 * 1024 {
            return Err("Server stream line is too large.".into());
        }
        Ok(events)
    }
}

pub fn parse(data: &str) -> Result<(Delta, Option<String>)> {
    let event: Value =
        serde_json::from_str(data).map_err(|e| format!("Invalid server stream: {e}"))?;
    if let Some(error) = event.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("The model rejected the chat request.")
            .into());
    }
    let choice = &event["choices"][0];
    let delta = &choice["delta"];
    Ok((
        Delta {
            metrics: metrics(&event),
            content: delta["content"].as_str().unwrap_or("").into(),
            reasoning: delta["reasoning_content"]
                .as_str()
                .or_else(|| delta["reasoning"].as_str())
                .unwrap_or("")
                .into(),
            ..Delta::default()
        },
        choice["finish_reason"].as_str().map(str::to_owned),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timings_and_usage_only_chunks_preserve_real_measurements() {
        let (delta, _) = parse(r#"{"choices":[{"delta":{"reasoning_content":"Thinking"}}],"timings":{"cache_n":236,"prompt_n":1,"predicted_n":35,"predicted_ms":661.064,"predicted_per_second":52.9449,"prompt_ms":30.958}}"#).unwrap();
        let mut current = delta.metrics.unwrap();
        assert_eq!(current.context_tokens, Some(272));
        let (delta, finish) = parse(r#"{"choices":[],"usage":{"prompt_tokens":237,"completion_tokens":36,"total_tokens":273}}"#).unwrap();
        assert!(delta.content.is_empty());
        assert!(finish.is_none());
        current.merge(&delta.metrics.unwrap());
        assert_eq!(current.context_tokens, Some(273));
        assert_eq!(current.context_source.as_deref(), Some("usage"));
        assert_eq!(current.output_tokens, Some(36));
        assert_eq!(current.tokens_per_second, Some(52.9449));
        assert_eq!(current.generation_ms, Some(661.064));
        assert!(parse(r#"{"choices":[{"delta":{"content":"text"}}]}"#)
            .unwrap()
            .0
            .metrics
            .is_none());
        assert!(
            parse(r#"{"choices":[],"timings":{"predicted_n":-2,"predicted_per_second":-1}}"#)
                .unwrap()
                .0
                .metrics
                .unwrap()
                .tokens_per_second
                .is_none()
        );
    }

    #[test]
    fn fragmented_unicode_crlf_comments_and_multiple_events() {
        let wire = ": heartbeat\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"caffè ☕\"}}]}\r\n\r\ndata: [DONE]\n\n";
        for size in 1..wire.len() {
            let mut decoder = Decoder::default();
            let mut events = Vec::new();
            for bytes in wire.as_bytes().chunks(size) {
                events.extend(decoder.push(bytes).unwrap());
            }
            assert_eq!(parse(&events[0]).unwrap().0.content, "caffè ☕");
            assert_eq!(events[1], "[DONE]");
        }
    }

    #[test]
    fn reasoning_limits_and_errors() {
        let (delta, reason) = parse(
            r#"{"choices":[{"delta":{"reasoning_content":"Thinking"},"finish_reason":"length"}]}"#,
        )
        .unwrap();
        assert_eq!(delta.reasoning, "Thinking");
        assert_eq!(reason.as_deref(), Some("length"));
        assert!(
            parse(r#"{"error":{"message":"Unsupported chat template"}}"#)
                .unwrap_err()
                .contains("chat template")
        );
        let mut decoder = Decoder::default();
        assert!(decoder.push(&vec![b'x'; 2 * 1024 * 1024 + 1]).is_err());
    }
}

// OpenAI streams can fragment the tool name, ID and JSON arguments independently.
#[derive(Default)]
pub struct ToolCalls(std::collections::BTreeMap<usize, ToolCall>);
#[derive(Clone, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}
impl ToolCalls {
    pub fn push(&mut self, event: &Value) -> Result<()> {
        if let Some(calls) = event["choices"][0]["delta"]["tool_calls"].as_array() {
            for call in calls {
                let index = call["index"].as_u64().unwrap_or(0) as usize;
                if index >= 8 {
                    return Err("The model requested too many tools at once.".into());
                }
                let current = self.0.entry(index).or_default();
                for (target, value) in [
                    (&mut current.id, &call["id"]),
                    (&mut current.name, &call["function"]["name"]),
                    (&mut current.arguments, &call["function"]["arguments"]),
                ] {
                    if let Some(fragment) = value.as_str() {
                        if target.len() + fragment.len() > 16384 {
                            return Err("The model tool request is too large.".into());
                        }
                        target.push_str(fragment);
                    }
                }
            }
        }
        Ok(())
    }
    pub fn finish(self) -> Vec<ToolCall> {
        self.0.into_values().collect()
    }
}
