use crate::{
    web_search::{provider::SearchProvider, types::*},
    Result as AppResult,
};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, Response};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use url::Url;

pub fn info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId("tavily".into()),
        name: "Tavily".into(),
        signup_url: Url::parse("https://app.tavily.com").unwrap(),
        key_placeholder: "tvly-…".into(),
        plan_description:
            "Free plan: 1,000 credits a month, no card required. A search costs 1 credit.".into(),
        search_cost_description: "about 1 credit each".into(),
    }
}

pub struct Tavily {
    client: Client,
    base: Url,
    key: String,
}
impl Tavily {
    pub fn new(key: String) -> AppResult<Self> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .user_agent("Straggler desktop")
            .build()
            .map_err(|_| "Cannot prepare the web search client.")?;
        Ok(Self {
            client,
            base: Url::parse("https://api.tavily.com/").unwrap(),
            key,
        })
    }
    fn request_body(request: &SearchRequest) -> Value {
        let mut body = json!({
            "query": request.query, "max_results": request.max_results, "topic": "general",
            "search_depth": "basic", "auto_parameters": false,
            "include_answer": false, "include_raw_content": false,
            "include_usage": true, "include_favicon": true, "include_published_date": true,
            "include_domains": request.include_domains, "exclude_domains": request.exclude_domains,
        });
        if let Some(recency) = &request.recency {
            body["time_range"] = json!(match recency {
                Recency::Day => "day",
                Recency::Week => "week",
                Recency::Month => "month",
                Recency::Year => "year",
            });
        }
        if let Some(region) = &request.region {
            if let Some(country) = country_name(&region.0) {
                body["country"] = json!(country);
            } else {
                eprintln!("Web search: unsupported region filter ignored.");
            }
        }
        body
    }
    async fn read(response: Response) -> std::result::Result<Value, SearchError> {
        let status = response.status().as_u16();
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok());
        match status {
            200..=299 => {}
            401 => return Err(SearchError::InvalidCredentials),
            429 => {
                return Err(SearchError::RateLimited {
                    retry_after_s: retry,
                })
            }
            432 | 433 => return Err(SearchError::QuotaExhausted),
            400 | 422 => {
                return Err(SearchError::InvalidRequest(
                    "The search service rejected this request.".into(),
                ))
            }
            _ => return Err(SearchError::ProviderUnavailable),
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(network_error)?;
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(SearchError::ProviderUnavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| SearchError::ProviderUnavailable)
    }
    async fn post(&self, endpoint: &str, body: Value) -> std::result::Result<Value, SearchError> {
        let response = self
            .client
            .post(self.base.join(endpoint).unwrap())
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .map_err(network_error)?;
        Self::read(response).await
    }
    fn normalize(
        request: &SearchRequest,
        value: Value,
        elapsed_ms: u32,
    ) -> std::result::Result<SearchResponse, SearchError> {
        let results = value["results"]
            .as_array()
            .ok_or(SearchError::ProviderUnavailable)?;
        let mut hits = vec![];
        for result in results.iter().take(request.max_results as usize) {
            let Some(url) = result["url"].as_str().and_then(|s| Url::parse(s).ok()) else {
                continue;
            };
            let Ok(mut hit) = SearchHit::new(
                result["title"].as_str().unwrap_or_default().into(),
                url,
                result["content"].as_str().unwrap_or_default(),
            ) else {
                continue;
            };
            hit.published_at = result["published_date"].as_str().map(str::to_owned);
            hit.score = result["score"]
                .as_f64()
                .filter(|s| s.is_finite())
                .map(|n| n as f32);
            hit.favicon_url = result["favicon"]
                .as_str()
                .and_then(|s| Url::parse(s).ok())
                .filter(|url| validate_url(url).is_ok());
            hits.push(hit);
        }
        // Provider diagnostics are never forwarded with normalized results.
        if let Some(id) = value["request_id"]
            .as_str()
            .filter(|s| s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        {
            eprintln!(
                "Web search request {id}, response time {:?}",
                value["response_time"].as_f64()
            );
        }
        Ok(SearchResponse {
            query: request.query.clone(),
            hits,
            provider: info().id,
            elapsed_ms,
            cost_units: value["usage"]["credits"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok()),
        })
    }
}
fn network_error(error: reqwest::Error) -> SearchError {
    if error.is_timeout() {
        SearchError::Timeout
    } else {
        SearchError::Offline
    }
}

#[async_trait]
impl SearchProvider for Tavily {
    fn id(&self) -> ProviderId {
        info().id
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            fetch: true,
            recency: true,
            region: true,
            domain_filters: true,
            quota: true,
        }
    }
    async fn search(
        &self,
        request: &SearchRequest,
    ) -> std::result::Result<SearchResponse, SearchError> {
        request.validate()?;
        let started = Instant::now();
        let value = self.post("search", Self::request_body(request)).await?;
        Self::normalize(
            request,
            value,
            started.elapsed().as_millis().min(u32::MAX as u128) as u32,
        )
    }
    async fn fetch(&self, url: &Url) -> std::result::Result<PageContent, SearchError> {
        validate_url(url)?;
        let value = self.post("extract", json!({"urls": [url], "format": "markdown", "extract_depth": "basic", "include_usage": true})).await?;
        if value["failed_results"].as_array().is_some_and(|results| {
            results
                .iter()
                .any(|result| result["url"].as_str() == Some(url.as_str()))
        }) {
            return Err(SearchError::FetchFailed { url: url.clone() });
        }
        let result = value["results"].as_array().and_then(|results| {
            results
                .iter()
                .find(|result| result["url"].as_str() == Some(url.as_str()))
        });
        let markdown = result
            .and_then(|r| r["raw_content"].as_str())
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| SearchError::FetchFailed { url: url.clone() })?;
        Ok(PageContent {
            url: url.clone(),
            title: None,
            markdown: markdown.into(),
            truncated: false,
            source: FetchSource::Provider,
        })
    }
    async fn quota(&self) -> std::result::Result<Option<QuotaStatus>, SearchError> {
        let response = self
            .client
            .get(self.base.join("usage").unwrap())
            .bearer_auth(&self.key)
            .send()
            .await
            .map_err(network_error)?;
        let value = Self::read(response).await?;
        let used = value["account"]["plan_usage"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or(SearchError::ProviderUnavailable)?;
        let limit = value["account"]["plan_limit"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok());
        Ok(Some(QuotaStatus {
            used,
            limit,
            resets_on: None,
        }))
    }
    async fn verify(&self) -> std::result::Result<(), SearchError> {
        self.quota().await.map(|_| ())
    }
}

// API country names are distinct from Straggler's ISO country codes.
fn country_name(code: &str) -> Option<&'static str> {
    match code.to_ascii_uppercase().as_str() {
        "AD" => Some("andorra"),
        "AE" => Some("united arab emirates"),
        "AF" => Some("afghanistan"),
        "AG" => Some("antigua and barbuda"),
        "AI" => Some("anguilla"),
        "AL" => Some("albania"),
        "AM" => Some("armenia"),
        "AO" => Some("angola"),
        "AQ" => Some("antarctica"),
        "AR" => Some("argentina"),
        "AS" => Some("american samoa"),
        "AT" => Some("austria"),
        "AU" => Some("australia"),
        "AW" => Some("aruba"),
        "AX" => Some("land islands"),
        "AZ" => Some("azerbaijan"),
        "BA" => Some("bosnia and herzegovina"),
        "BB" => Some("barbados"),
        "BD" => Some("bangladesh"),
        "BE" => Some("belgium"),
        "BF" => Some("burkina faso"),
        "BG" => Some("bulgaria"),
        "BH" => Some("bahrain"),
        "BI" => Some("burundi"),
        "BJ" => Some("benin"),
        "BL" => Some("saint barth lemy"),
        "BM" => Some("bermuda"),
        "BN" => Some("brunei"),
        "BO" => Some("bolivia"),
        "BQ" => Some("bonaire sint eustatius and saba"),
        "BR" => Some("brazil"),
        "BS" => Some("bahamas"),
        "BT" => Some("bhutan"),
        "BV" => Some("bouvet island"),
        "BW" => Some("botswana"),
        "BY" => Some("belarus"),
        "BZ" => Some("belize"),
        "CA" => Some("canada"),
        "CC" => Some("cocos keeling islands"),
        "CD" => Some("democratic republic of the congo"),
        "CF" => Some("central african republic"),
        "CG" => Some("congo"),
        "CH" => Some("switzerland"),
        "CI" => Some("c te d ivoire"),
        "CK" => Some("cook islands"),
        "CL" => Some("chile"),
        "CM" => Some("cameroon"),
        "CN" => Some("china"),
        "CO" => Some("colombia"),
        "CR" => Some("costa rica"),
        "CU" => Some("cuba"),
        "CV" => Some("cabo verde"),
        "CW" => Some("cura ao"),
        "CX" => Some("christmas island"),
        "CY" => Some("cyprus"),
        "CZ" => Some("czech republic"),
        "DE" => Some("germany"),
        "DJ" => Some("djibouti"),
        "DK" => Some("denmark"),
        "DM" => Some("dominica"),
        "DO" => Some("dominican republic"),
        "DZ" => Some("algeria"),
        "EC" => Some("ecuador"),
        "EE" => Some("estonia"),
        "EG" => Some("egypt"),
        "EH" => Some("western sahara"),
        "ER" => Some("eritrea"),
        "ES" => Some("spain"),
        "ET" => Some("ethiopia"),
        "FI" => Some("finland"),
        "FJ" => Some("fiji"),
        "FK" => Some("falkland islands malvinas"),
        "FM" => Some("micronesia federated states of"),
        "FO" => Some("faroe islands"),
        "FR" => Some("france"),
        "GA" => Some("gabon"),
        "GB" => Some("united kingdom"),
        "GD" => Some("grenada"),
        "GE" => Some("georgia"),
        "GF" => Some("french guiana"),
        "GG" => Some("guernsey"),
        "GH" => Some("ghana"),
        "GI" => Some("gibraltar"),
        "GL" => Some("greenland"),
        "GM" => Some("gambia"),
        "GN" => Some("guinea"),
        "GP" => Some("guadeloupe"),
        "GQ" => Some("equatorial guinea"),
        "GR" => Some("greece"),
        "GS" => Some("south georgia and the south sandwich islands"),
        "GT" => Some("guatemala"),
        "GU" => Some("guam"),
        "GW" => Some("guinea bissau"),
        "GY" => Some("guyana"),
        "HK" => Some("hong kong"),
        "HM" => Some("heard island and mcdonald islands"),
        "HN" => Some("honduras"),
        "HR" => Some("croatia"),
        "HT" => Some("haiti"),
        "HU" => Some("hungary"),
        "ID" => Some("indonesia"),
        "IE" => Some("ireland"),
        "IL" => Some("israel"),
        "IM" => Some("isle of man"),
        "IN" => Some("india"),
        "IO" => Some("british indian ocean territory"),
        "IQ" => Some("iraq"),
        "IR" => Some("iran"),
        "IS" => Some("iceland"),
        "IT" => Some("italy"),
        "JE" => Some("jersey"),
        "JM" => Some("jamaica"),
        "JO" => Some("jordan"),
        "JP" => Some("japan"),
        "KE" => Some("kenya"),
        "KG" => Some("kyrgyzstan"),
        "KH" => Some("cambodia"),
        "KI" => Some("kiribati"),
        "KM" => Some("comoros"),
        "KN" => Some("saint kitts and nevis"),
        "KP" => Some("north korea"),
        "KR" => Some("south korea"),
        "KW" => Some("kuwait"),
        "KY" => Some("cayman islands"),
        "KZ" => Some("kazakhstan"),
        "LA" => Some("laos"),
        "LB" => Some("lebanon"),
        "LC" => Some("saint lucia"),
        "LI" => Some("liechtenstein"),
        "LK" => Some("sri lanka"),
        "LR" => Some("liberia"),
        "LS" => Some("lesotho"),
        "LT" => Some("lithuania"),
        "LU" => Some("luxembourg"),
        "LV" => Some("latvia"),
        "LY" => Some("libya"),
        "MA" => Some("morocco"),
        "MC" => Some("monaco"),
        "MD" => Some("moldova"),
        "ME" => Some("montenegro"),
        "MF" => Some("saint martin french part"),
        "MG" => Some("madagascar"),
        "MH" => Some("marshall islands"),
        "MK" => Some("north macedonia"),
        "ML" => Some("mali"),
        "MM" => Some("myanmar"),
        "MN" => Some("mongolia"),
        "MO" => Some("macao"),
        "MP" => Some("northern mariana islands"),
        "MQ" => Some("martinique"),
        "MR" => Some("mauritania"),
        "MS" => Some("montserrat"),
        "MT" => Some("malta"),
        "MU" => Some("mauritius"),
        "MV" => Some("maldives"),
        "MW" => Some("malawi"),
        "MX" => Some("mexico"),
        "MY" => Some("malaysia"),
        "MZ" => Some("mozambique"),
        "NA" => Some("namibia"),
        "NC" => Some("new caledonia"),
        "NE" => Some("niger"),
        "NF" => Some("norfolk island"),
        "NG" => Some("nigeria"),
        "NI" => Some("nicaragua"),
        "NL" => Some("netherlands"),
        "NO" => Some("norway"),
        "NP" => Some("nepal"),
        "NR" => Some("nauru"),
        "NU" => Some("niue"),
        "NZ" => Some("new zealand"),
        "OM" => Some("oman"),
        "PA" => Some("panama"),
        "PE" => Some("peru"),
        "PF" => Some("french polynesia"),
        "PG" => Some("papua new guinea"),
        "PH" => Some("philippines"),
        "PK" => Some("pakistan"),
        "PL" => Some("poland"),
        "PM" => Some("saint pierre and miquelon"),
        "PN" => Some("pitcairn"),
        "PR" => Some("puerto rico"),
        "PS" => Some("palestine state of"),
        "PT" => Some("portugal"),
        "PW" => Some("palau"),
        "PY" => Some("paraguay"),
        "QA" => Some("qatar"),
        "RE" => Some("r union"),
        "RO" => Some("romania"),
        "RS" => Some("serbia"),
        "RU" => Some("russia"),
        "RW" => Some("rwanda"),
        "SA" => Some("saudi arabia"),
        "SB" => Some("solomon islands"),
        "SC" => Some("seychelles"),
        "SD" => Some("sudan"),
        "SE" => Some("sweden"),
        "SG" => Some("singapore"),
        "SH" => Some("saint helena ascension and tristan da cunha"),
        "SI" => Some("slovenia"),
        "SJ" => Some("svalbard and jan mayen"),
        "SK" => Some("slovakia"),
        "SL" => Some("sierra leone"),
        "SM" => Some("san marino"),
        "SN" => Some("senegal"),
        "SO" => Some("somalia"),
        "SR" => Some("suriname"),
        "SS" => Some("south sudan"),
        "ST" => Some("sao tome and principe"),
        "SV" => Some("el salvador"),
        "SX" => Some("sint maarten dutch part"),
        "SY" => Some("syria"),
        "SZ" => Some("eswatini"),
        "TC" => Some("turks and caicos islands"),
        "TD" => Some("chad"),
        "TF" => Some("french southern territories"),
        "TG" => Some("togo"),
        "TH" => Some("thailand"),
        "TJ" => Some("tajikistan"),
        "TK" => Some("tokelau"),
        "TL" => Some("timor leste"),
        "TM" => Some("turkmenistan"),
        "TN" => Some("tunisia"),
        "TO" => Some("tonga"),
        "TR" => Some("t rkiye"),
        "TT" => Some("trinidad and tobago"),
        "TV" => Some("tuvalu"),
        "TW" => Some("taiwan"),
        "TZ" => Some("tanzania"),
        "UA" => Some("ukraine"),
        "UG" => Some("uganda"),
        "UM" => Some("united states minor outlying islands"),
        "US" => Some("united states"),
        "UY" => Some("uruguay"),
        "UZ" => Some("uzbekistan"),
        "VA" => Some("holy see vatican city state"),
        "VC" => Some("saint vincent and the grenadines"),
        "VE" => Some("venezuela"),
        "VG" => Some("virgin islands british"),
        "VI" => Some("virgin islands u s"),
        "VN" => Some("vietnam"),
        "VU" => Some("vanuatu"),
        "WF" => Some("wallis and futuna"),
        "WS" => Some("samoa"),
        "YE" => Some("yemen"),
        "YT" => Some("mayotte"),
        "ZA" => Some("south africa"),
        "ZM" => Some("zambia"),
        "ZW" => Some("zimbabwe"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn fixture(
        status: u16,
        body: String,
        retry: Option<u32>,
    ) -> (Tavily, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = [0; 16384];
            let _ = socket.read(&mut bytes).unwrap();
            let retry = retry
                .map(|n| format!("Retry-After: {n}\r\n"))
                .unwrap_or_default();
            write!(socket, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\n{retry}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let mut provider = Tavily::new("fixture-secret".into()).unwrap();
        provider.client = Client::builder().no_proxy().build().unwrap();
        provider.base = Url::parse(&format!("http://{address}/")).unwrap();
        (provider, thread)
    }
    #[test]
    fn search_body_keeps_basic_cost_and_normalizes_metadata() {
        let request = SearchRequest {
            query: "contract".into(),
            region: Some(CountryCode("IT".into())),
            ..Default::default()
        };
        let body = Tavily::request_body(&request);
        assert_eq!(body["search_depth"], "basic");
        assert_eq!(body["auto_parameters"], false);
        assert_eq!(body["include_answer"], false);
        assert_eq!(body["include_raw_content"], false);
        assert_eq!(body["country"], "italy");
        let response = Tavily::normalize(&request, json!({"results":[{"title":"Title","url":"https://example.org/a", "content":"è".repeat(800),"published_date":"2026-11-10","favicon":"https://example.org/icon.png", "score":0.5}], "usage":{"credits":1}, "answer":"ignored", "api_key":"never forwarded"}), 2).unwrap();
        assert_eq!(response.hits[0].snippet.chars().count(), 600);
        assert_eq!(response.cost_units, Some(1));
        assert_eq!(response.hits[0].domain, "example.org");
        let saved = serde_json::to_string(&response).unwrap();
        assert!(!saved.contains("api_key"));
        assert!(!saved.contains("ignored"));
    }
    #[tokio::test]
    async fn recorded_responses_obey_the_contract() {
        let request = SearchRequest {
            query: "contract".into(),
            ..Default::default()
        };
        let (provider, task) = fixture(200, json!({"results":[{"title":"Title","url":"https://example.org/a","content":"Snippet"}]}).to_string(), None);
        crate::web_search::contract_tests::assert_normal(&provider).await;
        task.join().unwrap();
        let (provider, task) = fixture(200, "{\"results\":[]}".into(), None);
        assert!(provider.search(&request).await.unwrap().hits.is_empty());
        task.join().unwrap();
        for (status, expected) in [
            (401, SearchError::InvalidCredentials),
            (
                429,
                SearchError::RateLimited {
                    retry_after_s: Some(60),
                },
            ),
            (432, SearchError::QuotaExhausted),
            (433, SearchError::QuotaExhausted),
            (503, SearchError::ProviderUnavailable),
            (
                422,
                SearchError::InvalidRequest("The search service rejected this request.".into()),
            ),
        ] {
            let (provider, task) = fixture(status, "{}".into(), Some(60));
            assert_eq!(provider.search(&request).await.unwrap_err(), expected);
            task.join().unwrap();
        }
        let (provider, task) = fixture(200, "not json".into(), None);
        assert_eq!(
            provider.search(&request).await.unwrap_err(),
            SearchError::ProviderUnavailable
        );
        task.join().unwrap();
        let url = Url::parse("https://example.org/a").unwrap();
        let (provider, task) = fixture(
            200,
            json!({"results":[],"failed_results":[{"url":url}]}).to_string(),
            None,
        );
        assert_eq!(
            provider.fetch(&url).await.unwrap_err(),
            SearchError::FetchFailed { url }
        );
        task.join().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut provider = Tavily::new("fixture-secret".into()).unwrap();
        provider.base = Url::parse(&format!("http://{address}/")).unwrap();
        assert_eq!(
            provider.search(&request).await.unwrap_err(),
            SearchError::Offline
        );
    }
}
