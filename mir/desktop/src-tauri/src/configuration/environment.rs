use crate::Result;
use std::{collections::BTreeMap, ffi::OsString, path::PathBuf, process::Command};

#[derive(Clone)]
pub struct Environment {
    pub variables: BTreeMap<OsString, OsString>,
    pub home: PathBuf,
    pub config: PathBuf,
    pub data: PathBuf,
    pub bundled_server: Option<PathBuf>,
}

impl Environment {
    pub fn capture(bundled_server: Option<PathBuf>) -> Result<Self> {
        let variables = std::env::vars_os().collect();
        #[cfg(all(feature = "app-store", target_os = "macos"))]
        let variables = {
            let mut variables: BTreeMap<OsString, OsString> = variables;
            let home = PathBuf::from(objc2_foundation::NSHomeDirectory().to_string());
            #[cfg(all(feature = "native-tests", debug_assertions))]
            let home = match std::env::var("MIR_STORE_TEST_SESSION") {
                Ok(session) => {
                    let session = uuid::Uuid::parse_str(&session)
                        .map_err(|_| "Invalid Store test session identifier.")?;
                    home.join(".mir-tests").join(session.to_string())
                }
                Err(_) => home,
            };
            variables.insert("HOME".into(), home.clone().into_os_string());
            variables.insert(
                "XDG_CONFIG_HOME".into(),
                home.join(".config").into_os_string(),
            );
            variables.insert(
                "XDG_DATA_HOME".into(),
                home.join(".local/share").into_os_string(),
            );
            variables
        };
        Self::from_variables(variables, bundled_server)
    }

    pub fn from_variables(
        variables: BTreeMap<OsString, OsString>,
        bundled_server: Option<PathBuf>,
    ) -> Result<Self> {
        let home = variables
            .get(&OsString::from("HOME"))
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or("HOME must be configured.")?;
        let root = |key: &str, default: PathBuf| {
            variables
                .get(&OsString::from(key))
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
                .unwrap_or(default)
        };
        let config = root("XDG_CONFIG_HOME", home.join(".config")).join("mir.cpp");
        let data = root("XDG_DATA_HOME", home.join(".local/share")).join("mir.cpp");
        if !home.is_absolute() || !config.is_absolute() || !data.is_absolute() {
            return Err("Home, configuration and data directories must be absolute.".into());
        }
        Ok(Self {
            home,
            config,
            data,
            variables,
            bundled_server,
        })
    }

    pub fn value(&self, name: &str) -> Option<String> {
        self.variables
            .get(&OsString::from(name))
            .map(|value| value.to_string_lossy().into_owned())
    }

    pub fn control(&self, name: &str, fallback: String) -> String {
        self.value(&format!("MIR_{name}")).unwrap_or(fallback)
    }

    pub fn command(&self, program: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(program);
        command.env_clear().envs(&self.variables);
        command
    }
}
