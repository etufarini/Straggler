use super::types::*;
use dom_smoothie::{Config, Readability, TextMode};
use futures_util::StreamExt;
use reqwest::Client;
use std::time::Duration;
use url::Url;

const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
pub async fn fetch(url: &Url, budget: usize) -> Result<PageContent, SearchError> {
    validate_url(url)?;
    tokio::time::timeout(Duration::from_secs(15), fetch_page(url, budget))
        .await
        .map_err(|_| SearchError::Timeout)?
}
async fn fetch_page(url: &Url, budget: usize) -> Result<PageContent, SearchError> {
    let mut target = url.clone();
    let mut final_response = None;
    for _ in 0..=3 {
        validate_url(&target)?;
        let lookup = target.clone();
        let addresses = tokio::task::spawn_blocking(move || lookup.socket_addrs(|| None))
            .await
            .map_err(|_| SearchError::ProviderUnavailable)?
            .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
        if addresses.is_empty()
            || addresses
                .iter()
                .any(|address| !public_address(address.ip()))
        {
            return Err(SearchError::InvalidRequest(
                "Web pages must use a public Internet address.".into(),
            ));
        }
        // Pin the validated addresses and validate each redirect independently.
        let client = Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(12))
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(target.host_str().unwrap_or_default(), &addresses)
            .user_agent("Straggler desktop")
            .build()
            .map_err(|_| SearchError::ProviderUnavailable)?;
        let response = client
            .get(target.clone())
            .send()
            .await
            .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| SearchError::FetchFailed { url: url.clone() })?;
            target = target
                .join(location)
                .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
        } else {
            final_response = Some(response);
            break;
        }
    }
    let response = final_response.ok_or_else(|| SearchError::FetchFailed { url: url.clone() })?;
    if !response.status().is_success()
        || validate_url(response.url()).is_err()
        || response
            .content_length()
            .is_some_and(|n| n > MAX_PAGE_BYTES as u64)
    {
        return Err(SearchError::FetchFailed { url: url.clone() });
    }
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
        if bytes.len() + chunk.len() > MAX_PAGE_BYTES {
            return Err(SearchError::FetchFailed { url: url.clone() });
        }
        bytes.extend_from_slice(&chunk);
    }
    if !content_type.contains("text/html") && !content_type.contains("application/xhtml+xml") {
        return Err(SearchError::FetchFailed { url: url.clone() });
    }
    let html = String::from_utf8_lossy(&bytes).into_owned();
    tokio::task::spawn_blocking(move || extract(final_url, &html, budget))
        .await
        .map_err(|_| SearchError::ProviderUnavailable)?
}
fn public_address(address: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match address {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && !ip.is_multicast()
                && octets[0] != 0
                && octets[0] < 240
                && !(octets[0] == 100 && (64..=127).contains(&octets[1]))
                && !(octets[0] == 198 && (18..=19).contains(&octets[1]))
        }
        IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4() {
                return public_address(IpAddr::V4(ipv4));
            }
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && ip.segments()[..2] != [0x2001, 0xdb8]
        }
    }
}

fn extract(url: Url, html: &str, budget: usize) -> Result<PageContent, SearchError> {
    let config = Config {
        text_mode: TextMode::Markdown,
        max_elements_to_parse: 30000,
        ..Default::default()
    };
    let mut reader = Readability::new(html, Some(url.as_str()), Some(config))
        .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
    let article = reader
        .parse()
        .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
    let text = article.text_content.to_string();
    if text.trim().is_empty() {
        return Err(SearchError::FetchFailed { url });
    }
    Ok(PageContent {
        url,
        title: Some(article.title),
        truncated: text.chars().count() > budget,
        markdown: text.chars().take(budget).collect(),
        source: FetchSource::Local,
        cost_units: Some(0),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pages_cannot_reach_local_networks_or_metadata_services() {
        for address in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.1.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
        ] {
            assert!(!public_address(address.parse().unwrap()), "{address}");
        }
        assert!(public_address("8.8.8.8".parse().unwrap()));
        assert!(public_address("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn readability_strips_navigation_and_respects_markdown_budget() {
        let html = format!("<html><head><title>Article</title></head><body><nav>Navigation</nav><article><h1>Article</h1><p>{}</p><p><strong>Important</strong> source.</p></article></body></html>", "Readable sentences about the subject. ".repeat(100));
        let page = extract(
            Url::parse("https://example.org/article").unwrap(),
            &html,
            600,
        )
        .unwrap();
        assert!(page.truncated);
        assert_eq!(page.markdown.chars().count(), 600);
        assert!(!page.markdown.contains("Navigation"));
    }
    #[tokio::test]
    async fn rejects_non_http_and_unreadable_pages() {
        assert!(fetch(&Url::parse("file:///etc/passwd").unwrap(), 1000)
            .await
            .is_err());
        assert!(extract(
            Url::parse("https://example.org").unwrap(),
            "<html><body></body></html>",
            1000
        )
        .is_err());
    }
}
