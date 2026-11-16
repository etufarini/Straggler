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
        .map_err(|error| format!("Cannot restore model file or folder permission: {error}"))?;
        // Every successful start is paired with stop by this guard's Drop.
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err(
                "Model file or folder permission has expired. Choose it again in Settings.".into(),
            );
        }
        Ok((Self(url), stale.as_bool()))
    }

    fn bookmark(url: &NSURL) -> Result<Vec<u8>> {
        url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map(|data| data.to_vec())
        .map_err(|error| format!("Cannot keep model file or folder permission: {error}"))
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
    internal: Mutex<Option<PathBuf>>,
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
                        "Cannot read saved model file or folder permissions: {error}"
                    ))
                }
            };
            use std::io::Read;
            let mut bytes = Vec::new();
            file.take(MAX_BOOKMARK_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 > MAX_BOOKMARK_BYTES {
                return Err("Saved model file or folder permissions exceed the size limit.".into());
            }
            grants.bookmarks = serde_json::from_slice(&bytes).map_err(|error| {
                format!("Cannot read saved model file or folder permissions: {error}")
            })?;
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
            grants.warning.push_str(&format!(
                "{error} Choose the affected files or folders again.\n"
            ));
        }
        Self {
            path,
            grants: Mutex::new(grants),
            internal: Mutex::new(None),
        }
    }

    fn persist(path: &Path, bookmarks: &BTreeMap<String, Vec<u8>>) -> Result<()> {
        let bytes = serde_json::to_vec(bookmarks).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BOOKMARK_BYTES {
            return Err("Too many saved model file or folder permissions.".into());
        }
        fs::create_dir_all(
            path.parent()
                .ok_or("Missing permission storage directory.")?,
        )
        .map_err(|error| error.to_string())?;
        write_atomic(path, &bytes)
    }

    pub fn remember(&self, path: &Path) -> Result<()> {
        self.remember_resource(path, true)
    }

    pub fn remember_file(&self, path: &Path) -> Result<()> {
        self.remember_resource(path, false)
    }

    fn remember_resource(&self, path: &Path, directory: bool) -> Result<()> {
        let resource = path
            .to_str()
            .ok_or("Choose a file or folder with a valid UTF-8 path.")?;
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(resource), directory);
        let bookmark = Scope::bookmark(&url)?;
        let (scope, _) = Scope::resolve(&bookmark)?;
        if directory {
            fs::read_dir(path)
                .map_err(|error| format!("Cannot read the selected folder: {error}"))?;
        } else {
            fs::File::open(path)
                .map_err(|error| format!("Cannot read the selected file: {error}"))?;
        }
        let mut grants = self.grants.lock().map_err(|error| error.to_string())?;
        let mut next = grants.bookmarks.clone();
        next.insert(resource.into(), bookmark);
        Self::persist(&self.path, &next)?;
        grants.bookmarks = next;
        grants.active.insert(resource.into(), scope);
        grants.warning.clear();
        Ok(())
    }

    pub fn permits(&self, path: &Path) -> bool {
        if self
            .internal
            .lock()
            .is_ok_and(|root| root.as_ref().is_some_and(|root| path.starts_with(root)))
        {
            return true;
        }
        self.grants
            .lock()
            .is_ok_and(|grants| grants.active.keys().any(|folder| path.starts_with(folder)))
    }

    pub fn allow_internal(&self, path: &Path) -> Result<()> {
        *self.internal.lock().map_err(|e| e.to_string())? = Some(path.to_owned());
        Ok(())
    }

    pub fn warning(&self) -> String {
        self.grants
            .lock()
            .map(|grants| grants.warning.clone())
            .unwrap_or_else(|error| {
                format!("Cannot inspect model file or folder permissions: {error}")
            })
    }
}
