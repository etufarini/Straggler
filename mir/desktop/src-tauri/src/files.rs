use crate::Result;
#[cfg(not(all(feature = "app-store", target_os = "macos")))]
use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    if !path.is_absolute() {
        return Err("Choose an absolute file path in the save dialog.".into());
    }
    write_platform_atomic(path, contents)
}

#[cfg(all(feature = "app-store", target_os = "macos"))]
fn write_platform_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    use objc2_foundation::{NSData, NSDataWritingOptions, NSString, NSURL};
    let path = path
        .to_str()
        .ok_or("Choose a destination with a valid UTF-8 path.")?;
    let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(path), false);
    // Foundation's atomic writer supports the Save panel's file grant.
    // A manually created sibling temporary file has no sandbox permission.
    NSData::with_bytes(contents)
        .writeToURL_options_error(&url, NSDataWritingOptions::Atomic)
        .map_err(|error| format!("Cannot save the file. Previous data was kept: {error}"))
}

#[cfg(not(all(feature = "app-store", target_os = "macos")))]
fn write_platform_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or("The destination has no parent directory.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create the destination file: {e}"))?;
    file.write_all(contents)
        .and_then(|()| file.as_file().sync_all())
        .map_err(|e| format!("Cannot write the destination file: {e}"))?;
    file.persist(path)
        .map_err(|e| format!("Cannot save the file. Previous data was kept: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn atomic_export_replaces_utf8_and_cleans_up_failed_writes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("chat.json");
        fs::write(&path, "Previous export").unwrap();
        write_atomic(&path, "{\"content\":\"caffè ☕\"}\n".as_bytes()).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"content\":\"caffè ☕\"}\n"
        );
        assert!(write_atomic(directory.path(), b"invalid target").is_err());
        assert!(write_atomic(&directory.path().join("missing/chat.json"), b"data").is_err());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        assert!(write_atomic(Path::new("relative.json"), b"data").is_err());
    }
}
