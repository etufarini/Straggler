use crate::Result;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Default, Serialize)]
pub struct Delta {
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
            content: delta["content"].as_str().unwrap_or("").into(),
            reasoning: delta["reasoning_content"]
                .as_str()
                .or_else(|| delta["reasoning"].as_str())
                .unwrap_or("")
                .into(),
        },
        choice["finish_reason"].as_str().map(str::to_owned),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
