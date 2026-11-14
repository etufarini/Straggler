use super::api::{valid_sha256, RemoteFile};
use crate::{configuration::models::split_file_name, Result};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub path: String,
    pub label: String,
    pub size: u64,
    pub parts: usize,
    pub error: Option<String>,
}

pub fn file_group<'a>(files: &'a [RemoteFile], selected: &str) -> Result<Vec<&'a RemoteFile>> {
    if let Some((prefix, _, total)) = split_file_name(selected) {
        (1..=total)
            .map(|part| {
                let path = format!("{prefix}-{part:05}-of-{total:05}.gguf");
                files
                    .iter()
                    .find(|file| file.path == path)
                    .ok_or_else(|| "This split model is missing one or more parts.".into())
            })
            .collect()
    } else {
        Ok(vec![files
            .iter()
            .find(|file| file.path == selected)
            .ok_or(
                "Refresh the repository before choosing this file.",
            )?])
    }
}

pub fn variants(files: &[RemoteFile]) -> Vec<Variant> {
    files
        .iter()
        .filter(|file| split_file_name(&file.path).is_none_or(|(_, part, _)| part == 1))
        .map(|file| {
            let group = file_group(files, &file.path);
            let (size, parts, error) = match group {
                Ok(group) => {
                    let size = group
                        .iter()
                        .try_fold(0u64, |sum, file| sum.checked_add(file.size));
                    let error = if size.is_none() {
                        Some("The file group is too large.".into())
                    } else if group
                        .iter()
                        .any(|file| !file.sha256.as_deref().is_some_and(valid_sha256))
                    {
                        Some("SHA-256 is not reported for every file.".into())
                    } else {
                        None
                    };
                    (size.unwrap_or(0), group.len(), error)
                }
                Err(error) => (file.size, 1, Some(error)),
            };
            Variant {
                path: file.path.clone(),
                label: file.path.clone(),
                size,
                parts,
                error,
            }
        })
        .collect()
}
