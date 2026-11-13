use crate::{files::write_atomic, Result};
use objc2::{rc::Retained, runtime::Bool};
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_BOOKMARK_BYTES: u64 = 2 * 1024 * 1024;

struct Scope(Retained<NSURL>);

impl Scope {
    fn resolve(bytes: &[u8]) -> Result<(Self, bool)> {
        let data = NSData::with_bytes(bytes);
        let mut stale = Bool::NO;
        // The out parameter is valid for this synchronous Foundation call.
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope
                    | NSURLBookmarkResolutionOptions::WithoutUI
                    | NSURLBookmarkResolutionOptions::WithoutMounting,
                None,
                &mut stale,
            )
        }
        .map_err(|error| format!("Cannot restore model-folder permission: {error}"))?;
        // Every successful start is paired with stop by this guard's Drop.
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err(
                "Model-folder permission has expired. Choose the folder again in Settings.".into(),
            );
        }
        Ok((Self(url), stale.as_bool()))
    }

    fn bookmark(url: &NSURL) -> Result<Vec<u8>> {
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope
                | NSURLBookmarkCreationOptions::SecurityScopeAllowOnlyReadAccess,
            None,
            None,
        )
        .map(|data| data.to_vec())
        .map_err(|error| format!("Cannot keep model-folder permission: {error}"))
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        unsafe { self.0.stopAccessingSecurityScopedResource() };
    }
}

#[derive(Default)]
struct Grants {
    bookmarks: BTreeMap<String, Vec<u8>>,
    active: BTreeMap<String, Scope>,
    warning: String,
}

pub struct ModelAccess {
    path: PathBuf,
    grants: Mutex<Grants>,
}

impl ModelAccess {
    pub fn restore(data: &Path) -> Self {
        let path = data.join("desktop/model-folders.json");
        let mut grants = Grants::default();
        let result = (|| -> Result<()> {
            let file = match fs::File::open(&path) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => {
                    return Err(format!(
                        "Cannot read saved model-folder permissions: {error}"
                    ))
                }
            };
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(MAX_BOOKMARK_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 > MAX_BOOKMARK_BYTES {
                return Err("Saved model-folder permissions exceed the size limit.".into());
            }
            grants.bookmarks = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Cannot read saved model-folder permissions: {error}"))?;
            let mut refreshed = false;
            for (folder, bytes) in &mut grants.bookmarks {
                match Scope::resolve(bytes) {
                    Ok((scope, stale)) => {
                        if stale {
                            match Scope::bookmark(&scope.0) {
                                Ok(new) => {
                                    *bytes = new;
                                    refreshed = true;
                                }
                                Err(error) => grants.warning.push_str(&format!("{error}\n")),
                            }
                        }
                        grants.active.insert(folder.clone(), scope);
                    }
                    Err(error) => grants
                        .warning
                        .push_str(&format!("{error} Choose {folder} again.\n")),
                }
            }
            if refreshed {
                Self::persist(&path, &grants.bookmarks)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            grants
                .warning
                .push_str(&format!("{error} Choose your models folder again.\n"));
        }
        Self {
            path,
            grants: Mutex::new(grants),
        }
    }

    fn persist(path: &Path, bookmarks: &BTreeMap<String, Vec<u8>>) -> Result<()> {
        let bytes = serde_json::to_vec(bookmarks).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BOOKMARK_BYTES {
            return Err("Too many saved model-folder permissions.".into());
        }
        fs::create_dir_all(
            path.parent()
                .ok_or("Missing permission storage directory.")?,
        )
        .map_err(|error| error.to_string())?;
        write_atomic(path, &bytes)
    }

    pub fn remember(&self, path: &Path) -> Result<()> {
        let folder = path
            .to_str()
            .ok_or("Choose a folder with a valid UTF-8 path.")?;
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(folder), true);
        let bookmark = Scope::bookmark(&url)?;
        let (scope, _) = Scope::resolve(&bookmark)?;
        fs::read_dir(path).map_err(|error| format!("Cannot read the selected folder: {error}"))?;
        let mut grants = self.grants.lock().map_err(|error| error.to_string())?;
        let mut next = grants.bookmarks.clone();
        next.insert(folder.into(), bookmark);
        Self::persist(&self.path, &next)?;
        grants.bookmarks = next;
        grants.active.insert(folder.into(), scope);
        grants.warning.clear();
        Ok(())
    }

    pub fn permits(&self, path: &Path) -> bool {
        self.grants
            .lock()
            .is_ok_and(|grants| grants.active.keys().any(|folder| path.starts_with(folder)))
    }

    pub fn warning(&self) -> String {
        self.grants
            .lock()
            .map(|grants| grants.warning.clone())
            .unwrap_or_else(|error| format!("Cannot inspect model-folder permissions: {error}"))
    }
}
