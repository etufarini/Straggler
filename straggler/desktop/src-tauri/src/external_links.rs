use crate::Result;

/// This policy is separate from search URLs: mail links never become fetch targets.
pub fn sanitize(value: &str) -> Result<String> {
    let invalid = || "Only HTTP, HTTPS and single-recipient email links can be opened.".to_string();
    if value.chars().any(char::is_control)
        || value.to_ascii_lowercase().contains("%0a")
        || value.to_ascii_lowercase().contains("%0d")
    {
        return Err(invalid());
    }
    let mut url = reqwest::Url::parse(value).map_err(|_| invalid())?;
    if url.scheme() != "mailto" {
        crate::web_search::types::validate_url(&url).map_err(|_| invalid())?;
        return Ok(url.into());
    }
    if url.has_host() {
        return Err(invalid());
    }
    let encoded = url.path().as_bytes();
    let mut decoded = Vec::new();
    let mut index = 0;
    while index < encoded.len() {
        if encoded[index] == b'%' {
            let hex = encoded.get(index + 1..index + 3).ok_or_else(invalid)?;
            let hex = std::str::from_utf8(hex).map_err(|_| invalid())?;
            decoded.push(u8::from_str_radix(hex, 16).map_err(|_| invalid())?);
            index += 3;
        } else {
            decoded.push(encoded[index]);
            index += 1;
        }
    }
    let address = String::from_utf8(decoded).map_err(|_| invalid())?;
    let (local, domain) = address.split_once('@').ok_or_else(invalid)?;
    if address.len() > 254
        || local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || address.to_ascii_lowercase().contains("%0a")
        || address.to_ascii_lowercase().contains("%0d")
        || !local
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"!#$%&'*+/=?^_`{|}~.-".contains(&c))
        || !domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label.as_bytes()[0].is_ascii_alphanumeric()
                && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return Err(invalid());
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn strips_mail_headers_without_broadening_web_policy() {
        assert_eq!(
            sanitize(
                "mailto:person@example.com?subject=Hi&body=Hello&cc=other@example.com#fragment"
            )
            .unwrap(),
            "mailto:person@example.com"
        );
        assert!(sanitize("https://example.com/path?q=1#part").is_ok());
        for value in [
            "javascript:alert(1)",
            "file:///tmp/a",
            "mailto:a@example.com,b@example.com",
            "mailto:a@example.com;b@example.com",
            "mailto:a@example.com?body=%0Ainject",
            "mailto:a%0D@example.com",
            "mailto:a@example.com\n",
            "mailto:a%250a@example.com",
            "mailto:a%00@example.com",
            "mailto:a..b@example.com",
            "mailto:a@-example.com",
            "mailto://a@example.com",
        ] {
            assert!(sanitize(value).is_err(), "Accepted {value}");
        }
    }
}
