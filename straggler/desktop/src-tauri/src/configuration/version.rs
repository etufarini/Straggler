use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendVersion {
    pub version: String,
    pub build_number: u64,
    pub commit: String,
}

/// `--version` is written to stderr by the pinned backend; probes collect both streams.
pub fn parse(output: &str) -> Option<BackendVersion> {
    output.lines().find_map(|line| {
        let value = line.trim().strip_prefix("version: ")?;
        let (version, build) = value.split_once(" (build ")?;
        let (number, commit) = build.strip_suffix(')')?.split_once(", commit ")?;
        if version.is_empty()
            || version.len() > 128
            || version.chars().any(char::is_whitespace)
            || commit.is_empty()
            || commit.len() > 128
            || !commit
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return None;
        }
        Some(BackendVersion {
            version: version.into(),
            build_number: number.parse().ok()?,
            commit: commit.into(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_upstream_stderr_contract_among_other_diagnostics() {
        let info = parse("initialization diagnostic\nversion: 0.9.0-dev (build 12248, commit 3837bf0bc)\nbuilt with a compiler\n").unwrap();
        assert_eq!(info.version, "0.9.0-dev");
        assert_eq!(info.build_number, 12248);
        assert_eq!(info.commit, "3837bf0bc");
    }

    #[test]
    fn rejects_incomplete_or_ambiguous_output_without_inventing_a_version() {
        for output in [
            "unavailable",
            "version: x (build NaN, commit abc)",
            "version: x (build 1, commit )",
            "version: x (build 1, commit abc) trailing text",
            "version: x y (build 1, commit abc)",
        ] {
            assert!(parse(output).is_none(), "{output}");
        }
    }
}
