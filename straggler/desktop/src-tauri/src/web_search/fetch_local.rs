use super::types::*;
use dom_smoothie::{Config, Readability, TextMode};
use futures_util::StreamExt;
use reqwest::Client;
use std::time::Duration;
use url::Url;

const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
pub async fn fetch(url: &Url, budget: usize) -> Result<PageContent, SearchError> {
    validate_url(url)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Straggler desktop")
        .build()
        .map_err(|_| SearchError::ProviderUnavailable)?;
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| SearchError::FetchFailed { url: url.clone() })?;
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
