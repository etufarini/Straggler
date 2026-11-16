//! Flatpak file and folder grants must come from the document portal.
use crate::Result;
use ashpd::desktop::{file_chooser::SelectedFiles, ResponseError};
use std::path::{Path, PathBuf};

pub fn requires_portal() -> bool {
    Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some()
}

pub async fn choose_folder() -> Result<Option<PathBuf>> {
    choose("Choose models folder", true).await
}

pub async fn choose_file(title: &str) -> Result<Option<PathBuf>> {
    choose(title, false).await
}

async fn choose(title: &str, directory: bool) -> Result<Option<PathBuf>> {
    let request = SelectedFiles::open_file()
        .title(title)
        .accept_label(if directory {
            "Use this folder"
        } else {
            "Use this file"
        })
        .directory(directory)
        .multiple(false)
        .modal(true)
        .send()
        .await;
    let selected = match request.and_then(|request| request.response()) {
        Ok(selected) => selected,
        Err(ashpd::Error::Response(ResponseError::Cancelled)) => return Ok(None),
        Err(error) => return Err(format!("Cannot open the system file portal: {error}")),
    };
    selected_path(selected.uris().iter().map(|uri| uri.as_str()))
}

fn selected_path<'a>(mut uris: impl Iterator<Item = &'a str>) -> Result<Option<PathBuf>> {
    let Some(uri) = uris.next() else {
        return Ok(None);
    };
    if uris.next().is_some() {
        return Err("The file portal returned more than one selection.".into());
    }
    let path = reqwest::Url::parse(uri)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .filter(|path| path.is_absolute())
        .ok_or("The file portal did not return a local path.")?;
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portal_results_preserve_cancel_hidden_names_and_encoded_paths() {
        assert_eq!(selected_path(std::iter::empty()).unwrap(), None);
        assert_eq!(
            selected_path(["file:///run/user/1000/doc/grant/.models%20folder"].into_iter())
                .unwrap(),
            Some(PathBuf::from("/run/user/1000/doc/grant/.models folder"))
        );
        for uris in [
            vec!["https://example.com/folder"],
            vec!["file:///a", "file:///b"],
        ] {
            assert!(selected_path(uris.into_iter()).is_err());
        }
    }
}
