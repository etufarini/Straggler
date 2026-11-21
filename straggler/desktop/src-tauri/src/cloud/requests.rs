use super::{CloudDestination, ProviderKind};
use crate::Result;
use serde_json::{json, Value};

pub(crate) fn reasoning(
    body: &mut Value,
    destination: &CloudDestination,
    on: &str,
    effort: &str,
) -> Result<()> {
    let details = &destination.active.model.details;
    // Chat defaults from a previous local model must not become undeclared cloud controls.
    if details.reasoning_supported != Some(true) {
        return Ok(());
    }
    if effort != "auto" && on != "off" && !details.effort_levels.iter().any(|value| value == effort)
    {
        return Err("The cloud model does not advertise this reasoning effort. Choose Default or an available level.".into());
    }
    match destination.active.kind {
        ProviderKind::DeepSeek => {
            if on != "auto" {
                body["thinking"] =
                    json!({ "type": if on == "on" { "enabled" } else { "disabled" } });
            }
            if on != "off" && effort != "auto" {
                body["reasoning_effort"] = json!(effort);
            }
        }
        ProviderKind::OpenRouter => {
            if on == "off" {
                body["reasoning"] = json!({"enabled": false});
            } else if on != "auto" || effort != "auto" {
                body["reasoning"] = json!({"enabled": true});
                if effort != "auto" {
                    body["reasoning"]["effort"] = json!(effort);
                }
            }
        }
        ProviderKind::Mistral => {
            if on == "off" && details.effort_levels.iter().any(|value| value == "none") {
                body["reasoning_effort"] = json!("none");
            } else if on == "off" {
                return Err("This cloud model does not advertise a way to turn reasoning off. Choose Default or an advertised effort.".into());
            } else if on != "off" && effort != "auto" {
                body["reasoning_effort"] = json!(effort);
            }
        }
        ProviderKind::Custom => {}
    }
    Ok(())
}

pub(crate) fn wire_body(body: &Value, destination: &CloudDestination) -> Value {
    let mut body = body.clone();
    if let Some(object) = body.as_object_mut() {
        for field in [
            "chat_template_kwargs",
            "id_slot",
            "cache_prompt",
            "timings_per_token",
        ] {
            object.remove(field);
        }
    }
    let carry_reasoning =
        destination.active.kind == ProviderKind::DeepSeek && body.get("tools").is_some();
    if let Some(messages) = body["messages"].as_array_mut() {
        for message in messages {
            if let Some(object) = message.as_object_mut() {
                if carry_reasoning && object.get("role").is_some_and(|role| role == "assistant") {
                    object.entry("reasoning_content").or_insert(json!(""));
                } else {
                    object.remove("reasoning_content");
                }
            }
        }
    }
    body
}
