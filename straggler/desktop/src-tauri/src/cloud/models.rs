use super::{CloudModel, ProviderKind};
use crate::{model::ServerDetails, Result};
use serde_json::Value;
use uuid::Uuid;

pub fn unknown_details() -> ServerDetails {
    ServerDetails {
        run_id: Uuid::nil(),
        context_size: None,
        tools_supported: None,
        vision_supported: None,
        reasoning_supported: None,
        effort_levels: Vec::new(),
        system_role_supported: None,
        error: None,
    }
}

pub fn parse(kind: ProviderKind, body: Value) -> Result<Vec<CloudModel>> {
    let entries = body
        .get("data")
        .and_then(Value::as_array)
        .ok_or("The cloud service did not return a model list.")?;
    let mut models = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for entry in entries {
        let Some(id) = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 1024 && !id.contains('\0'))
        else {
            continue;
        };
        if !ids.insert(id) {
            continue;
        }
        let mut details = unknown_details();
        match kind {
            ProviderKind::OpenRouter => {
                details.context_size = entry["context_length"].as_u64().filter(|n| *n > 0);
                details.vision_supported = entry
                    .pointer("/architecture/input_modalities")
                    .and_then(Value::as_array)
                    .map(|values| values.iter().any(|value| value == "image"));
                if let Some(parameters) = entry["supported_parameters"].as_array() {
                    details.tools_supported = Some(parameters.iter().any(|p| p == "tools"));
                    details.reasoning_supported = Some(parameters.iter().any(|p| p == "reasoning"));
                    if details.reasoning_supported == Some(true) {
                        details.effort_levels =
                            ["low", "medium", "high"].map(str::to_owned).to_vec();
                    }
                }
            }
            ProviderKind::Mistral => {
                details.context_size = entry["max_context_length"].as_u64().filter(|n| *n > 0);
                details.vision_supported = entry
                    .pointer("/capabilities/vision")
                    .and_then(Value::as_bool);
                details.tools_supported = entry
                    .pointer("/capabilities/function_calling")
                    .and_then(Value::as_bool);
                let declared = entry["supported_parameters"]
                    .as_array()
                    .map(|parameters| parameters.iter().any(|p| p == "reasoning_effort"));
                details.reasoning_supported = declared;
                if declared == Some(true) {
                    details.effort_levels = entry["reasoning_effort_levels"]
                        .as_array()
                        .map(|levels| {
                            levels
                                .iter()
                                .filter_map(Value::as_str)
                                .filter(|v| crate::model::valid_effort(v))
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default();
                }
            }
            ProviderKind::DeepSeek | ProviderKind::Custom => {}
        }
        models.push(CloudModel {
            id: id.into(),
            name: entry["name"]
                .as_str()
                .filter(|name| !name.is_empty() && name.len() <= 4096 && !name.contains('\0'))
                .unwrap_or(id)
                .into(),
            details,
        });
    }
    Ok(models)
}
