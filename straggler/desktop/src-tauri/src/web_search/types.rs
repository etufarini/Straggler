use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProviderId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Recency {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CountryCode(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchRequest {
    pub query: String,
    pub max_results: u8,
    pub recency: Option<Recency>,
    pub region: Option<CountryCode>,
    pub include_domains: Vec<String>,
    pub exclude_domains: Vec<String>,
}
impl Default for SearchRequest {
    fn default() -> Self {
        Self {
            query: String::new(),
            max_results: 5,
            recency: None,
            region: None,
            include_domains: vec![],
            exclude_domains: vec![],
        }
    }
}
impl SearchRequest {
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.query.trim().is_empty()
            || self.query.chars().count() > 4096
            || !(1..=10).contains(&self.max_results)
        {
            return Err(SearchError::InvalidRequest(
                "Enter a query and request between 1 and 10 results.".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub query: String,
    pub hits: Vec<SearchHit>,
    pub provider: ProviderId,
    pub elapsed_ms: u32,
    pub cost_units: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub title: String,
    pub url: Url,
    pub domain: String,
    pub snippet: String,
    pub published_at: Option<String>,
    pub score: Option<f32>,
    pub favicon_url: Option<Url>,
}
impl SearchHit {
    pub fn new(title: String, url: Url, snippet: &str) -> Result<Self, SearchError> {
        validate_url(&url)?;
        Ok(Self {
            title,
            domain: url.host_str().unwrap_or_default().to_owned(),
            url,
            snippet: snippet.chars().take(600).collect(),
            published_at: None,
            score: None,
            favicon_url: None,
        })
    }
}
pub fn validate_url(url: &Url) -> Result<(), SearchError> {
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(SearchError::InvalidRequest(
            "Web pages must use an HTTP or HTTPS URL without credentials.".into(),
        ));
    }
    Ok(())
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub url: Url,
    pub title: Option<String>,
    pub markdown: String,
    pub truncated: bool,
    pub source: FetchSource,
    pub cost_units: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum FetchSource {
    Local,
    Provider,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QuotaStatus {
    pub used: u32,
    pub limit: Option<u32>,
    pub resets_on: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail", rename_all = "snake_case")]
pub enum SearchError {
    NotConfigured,
    InvalidCredentials,
    QuotaExhausted,
    RateLimited { retry_after_s: Option<u32> },
    Offline,
    Timeout,
    InvalidRequest(String),
    FetchFailed { url: Url },
    ProviderUnavailable,
}
impl SearchError {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NotConfigured => "not_configured",
            Self::InvalidCredentials => "invalid_credentials",
            Self::QuotaExhausted => "quota_exhausted",
            Self::RateLimited { .. } => "rate_limited",
            Self::Offline => "offline",
            Self::Timeout => "timeout",
            Self::InvalidRequest(_) => "invalid_request",
            Self::FetchFailed { .. } => "fetch_failed",
            Self::ProviderUnavailable => "provider_unavailable",
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct Capabilities {
    pub fetch: bool,
    pub recency: bool,
    pub region: bool,
    pub domain_filters: bool,
    pub quota: bool,
}

// Provider presentation travels through the registry, keeping its branding and billing out of callers.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: ProviderId,
    pub name: String,
    pub signup_url: Url,
    pub key_placeholder: String,
    pub plan_description: String,
    pub search_cost_description: String,
}
