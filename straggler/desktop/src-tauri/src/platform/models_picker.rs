//! Flatpak folder grants must come from the document portal, without helper fallbacks.
use crate::Result;
use ashpd::desktop::{file_chooser::SelectedFiles, ResponseError};
use std::path::{Path, PathBuf};

pub fn requires_portal() -> bool {
    Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some()
}

pub async fn choose_folder() -> Result<Option<PathBuf>> {
    let request = SelectedFiles::open_file()
        .title("Choose models folder")
        .accept_label("Use this folder")
        .directory(true)
        .multiple(false)
        .modal(true)
        .send()
        .await;
    let selected = match request.and_then(|request| request.response()) {
        Ok(selected) => selected,
        Err(ashpd::Error::Response(ResponseError::Cancelled)) => return Ok(None),
        Err(error) => return Err(format!("Cannot open the system folder portal: {error}")),
    };
    selected_path(selected.uris().iter().map(|uri| uri.as_str()))
}

fn selected_path<'a>(mut uris: impl Iterator<Item = &'a str>) -> Result<Option<PathBuf>> {
    let Some(uri) = uris.next() else {
        return Ok(None);
    };
    if uris.next().is_some() {
        return Err("The folder portal returned more than one folder.".into());
    }
    let path = reqwest::Url::parse(uri)
        .ok()
        .and_then(|url| url.to_file_path().ok())
        .filter(|path| path.is_absolute())
        .ok_or("The folder portal did not return a local folder.")?;
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
