//! The Store variant retains only native-picker grants, separately from paths.conf.

#[cfg(all(feature = "app-store", not(target_os = "macos")))]
compile_error!("The app-store feature is only supported on macOS.");

#[cfg(all(feature = "app-store", target_os = "macos"))]
mod macos;
#[cfg(all(feature = "app-store", target_os = "macos"))]
pub use macos::ModelAccess;

#[cfg(not(feature = "app-store"))]
#[derive(Default)]
pub struct ModelAccess;

#[cfg(not(feature = "app-store"))]
impl ModelAccess {
    pub fn allow_internal(&self, _path: &std::path::Path) -> crate::Result<()> {
        Ok(())
    }

    pub fn remember(&self, _path: &std::path::Path) -> crate::Result<()> {
        Ok(())
    }
    pub fn remember_file(&self, _path: &std::path::Path) -> crate::Result<()> {
        Ok(())
    }
    pub fn restore(_data: &std::path::Path) -> Self {
        Self
    }

    pub fn warning(&self) -> String {
        String::new()
    }

    pub fn permits(&self, _path: &std::path::Path) -> bool {
        true
    }
}
