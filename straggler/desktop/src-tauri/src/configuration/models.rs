use crate::{workspace::Model, Result};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
};

struct Metadata {
    file: File,
    limit: u64,
    operations: usize,
    big_endian: bool,
}

impl Metadata {
    fn read(&mut self, length: usize) -> Option<Vec<u8>> {
        self.operations += 1;
        if self.operations > 500_000
            || self
                .file
                .stream_position()
                .ok()?
                .checked_add(length as u64)?
                > self.limit
        {
            return None;
        }
        let mut bytes = vec![0; length];
        self.file.read_exact(&mut bytes).ok()?;
        Some(bytes)
    }

    fn number(&mut self, length: usize) -> Option<u64> {
        let bytes = self.read(length)?;
        Some(if self.big_endian {
            bytes
                .iter()
                .fold(0, |value, byte| (value << 8) | u64::from(*byte))
        } else {
            bytes
                .iter()
                .rev()
                .fold(0, |value, byte| (value << 8) | u64::from(*byte))
        })
    }

    fn skip(&mut self, length: u64) -> Option<()> {
        let position = self.file.stream_position().ok()?.checked_add(length)?;
        if position > self.limit {
            return None;
        }
        self.file.seek(SeekFrom::Start(position)).ok()?;
        Some(())
    }

    fn string(&mut self, keep: bool) -> Option<String> {
        let size = self.number(8)?;
        if keep && size <= 4096 {
            return String::from_utf8(self.read(size as usize)?).ok();
        }
        self.skip(size)?;
        Some(String::new())
    }

    fn scalar_size(kind: u64) -> Option<usize> {
        match kind {
            0 | 1 | 7 => Some(1),
            2 | 3 => Some(2),
            4..=6 => Some(4),
            10..=12 => Some(8),
            _ => None,
        }
    }

    fn value(&mut self, kind: u64, key: &str) -> Option<bool> {
        if let Some(size) = Self::scalar_size(kind) {
            let value = self.number(size)?;
            let signed_positive =
                !matches!(kind, 1 | 3 | 5 | 11) || value & (1 << (size * 8 - 1)) == 0;
            return Some(
                key == "split.no" && !matches!(kind, 6 | 12) && value > 0 && signed_positive,
            );
        }
        if kind == 8 {
            let value = self.string(key == "general.type")?;
            return Some(key == "general.type" && matches!(value.as_str(), "mmproj" | "adapter"));
        }
        if kind != 9 {
            return None;
        }
        let subtype = self.number(4)?;
        let count = self.number(8)?;
        if let Some(size) = Self::scalar_size(subtype) {
            self.skip((size as u64).checked_mul(count)?)?;
        } else if subtype == 8 && count <= 100_000 {
            for _ in 0..count {
                self.string(false)?;
            }
        } else {
            return None;
        }
        Some(false)
    }
}

fn component(path: &Path) -> Option<bool> {
    let file = File::open(path).ok()?;
    let limit = file.metadata().ok()?.len().min(32 * 1024 * 1024);
    let mut metadata = Metadata {
        file,
        limit,
        operations: 0,
        big_endian: false,
    };
    if metadata.read(4)? != b"GGUF" {
        return None;
    }
    let version = metadata.read(4)?;
    if !matches!(u32::from_le_bytes(version.clone().try_into().ok()?), 2 | 3) {
        metadata.big_endian = true;
    }
    let version = if metadata.big_endian {
        u32::from_be_bytes(version.try_into().ok()?)
    } else {
        u32::from_le_bytes(version.try_into().ok()?)
    };
    if !matches!(version, 2 | 3) {
        return None;
    }
    metadata.number(8)?;
    let count = metadata.number(8)?;
    if count > 100_000 {
        return None;
    }
    let mut excluded = false;
    for _ in 0..count {
        let key = metadata.string(true)?;
        let kind = metadata.number(4)?;
        excluded |= metadata.value(kind, &key)?;
    }
    Some(excluded)
}

pub fn discover(root: &Path) -> Result<Vec<Model>> {
    if root.as_os_str().is_empty() {
        return Ok(Vec::new());
    }
    let mut models = Vec::new();
    let mut pending = vec![(root.to_owned(), 0)];
    while let Some((directory, depth)) = pending.pop() {
        let entries = fs::read_dir(&directory).map_err(|error| {
            format!("Cannot read models folder {}: {error}", directory.display())
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() {
                if depth < 2 {
                    pending.push((entry.path(), depth + 1));
                }
                continue;
            }
            let path = entry.path();
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if name.starts_with("._")
                || !name.to_ascii_lowercase().ends_with(".gguf")
                || !path.is_file()
            {
                continue;
            }
            if let Some((prefix, part, total)) = split_file_name(&name) {
                if part != 1
                    || !(1..=total).all(|part| {
                        directory
                            .join(format!("{prefix}-{part:05}-of-{total:05}.gguf"))
                            .is_file()
                    })
                {
                    continue;
                }
            }
            // Inspection failures retain a possibly supported model; tensors are never read.
            if component(&path) == Some(true) {
                continue;
            }
            let Some(value) = path.to_str() else {
                continue;
            };
            models.push(Model {
                path: value.into(),
                label: path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .into_owned(),
            });
        }
    }
    models.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(models)
}

/// llama.cpp's split GGUF convention identifies a file group, not model capabilities.
pub fn split_file_name(name: &str) -> Option<(&str, u32, u32)> {
    let stem = name.strip_suffix(".gguf")?;
    let (first, total) = stem.rsplit_once("-of-")?;
    let (prefix, part) = first.rsplit_once('-')?;
    if prefix.is_empty() || part.len() != 5 || total.len() != 5 {
        return None;
    }
    let part: u32 = part.parse().ok()?;
    let total: u32 = total.parse().ok()?;
    (part > 0 && part <= total).then_some((prefix, part, total))
}
