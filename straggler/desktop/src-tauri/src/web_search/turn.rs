use super::{
    budget::TurnBudget,
    citations::{Citations, Source},
    fetch_local,
    provider::SearchProvider,
    tools,
    types::*,
    WebSearchService,
};
use crate::{stream::Delta, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;
use uuid::Uuid;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnSummary {
    pub queries: Vec<String>,
    pub credits: u32,
    pub fallback: bool,
    pub errors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_url: Option<String>,
}
#[derive(Clone, Debug)]
pub struct WebEvent {
    pub name: &'static str,
    pub payload: Value,
}

pub struct SearchTurn {
    id: Uuid,
    pub citations: Citations,
    pub summary: TurnSummary,
    budget: TurnBudget,
    remaining: usize,
    failed: bool,
}
impl SearchTurn {
    pub fn new(id: Uuid, limit: u8, remaining: usize, fallback: bool) -> Self {
        Self {
            id,
            citations: Citations::default(),
            summary: TurnSummary {
                fallback,
                ..Default::default()
            },
            budget: TurnBudget::new(limit),
            remaining,
            failed: false,
        }
    }
    pub fn update(
        &self,
        event: Option<WebEvent>,
        emit: &mut impl FnMut(Delta) -> Result<()>,
    ) -> Result<()> {
        emit(Delta {
            sources: Some(self.citations.sources.clone()),
            web_search: Some(self.summary.clone()),
            web_events: event.into_iter().collect(),
            ..Default::default()
        })
    }
    pub fn fail(
        &mut self,
        error: &SearchError,
        emit: &mut impl FnMut(Delta) -> Result<()>,
    ) -> Result<()> {
        self.failed = true;
        self.summary.active_query = None;
        self.summary.active_url = None;
        let kind = error.kind().to_owned();
        if !self.summary.errors.contains(&kind) {
            self.summary.errors.push(kind.clone());
        }
        self.update(
            Some(WebEvent {
                name: "web_search:failed",
                payload: json!({"turn_id":self.id,"error_kind":kind}),
            }),
            emit,
        )
    }
    pub async fn search(
        &mut self,
        service: &WebSearchService,
        provider: &dyn SearchProvider,
        query: &str,
        emit: &mut impl FnMut(Delta) -> Result<()>,
    ) -> Result<String> {
        if self.failed {
            return Ok("Web search is unavailable. Answer without web search and say that current information could not be checked.".into());
        }
        if !self.budget.search() {
            return Ok("Search limit reached for this message. Use the results already available and write the answer now.".into());
        }
        if self.remaining == 0 {
            return Ok(
                "No context space remains for web results. Answer with the available context."
                    .into(),
            );
        }
        self.summary.queries.push(query.to_owned());
        self.summary.active_query = Some(query.to_owned());
        self.update(
            Some(WebEvent {
                name: "web_search:started",
                payload: json!({"turn_id":self.id,"query":query}),
            }),
            emit,
        )?;
        let request = SearchRequest {
            query: query.into(),
            ..Default::default()
        };
        match service.search(provider, &request).await {
            Ok((response, cached)) => {
                self.summary.active_query = None;
                self.summary.credits = self
                    .summary
                    .credits
                    .saturating_add(response.cost_units.unwrap_or(0));
                let sources = self.citations.register(&response.hits);
                let text = if response.hits.is_empty() {
                    "No web results found.".into()
                } else {
                    tools::results(&response.hits, &sources, &mut self.remaining)
                };
                self.update(Some(WebEvent { name: "web_search:completed", payload: json!({"turn_id":self.id,"query":query,"hits":sources,"cached":cached}) }), emit)?;
                Ok(text)
            }
            Err(error) => {
                self.fail(&error, emit)?;
                Ok("Web search failed. Answer without web search; do not claim current information was verified.".into())
            }
        }
    }
    pub async fn fetch(
        &mut self,
        service: &WebSearchService,
        provider: &dyn SearchProvider,
        url: &str,
        emit: &mut impl FnMut(Delta) -> Result<()>,
    ) -> Result<String> {
        let url = match Url::parse(url) {
            Ok(url) if validate_url(&url).is_ok() => url,
            _ => return Ok("Use an HTTP or HTTPS source URL from the search results.".into()),
        };
        if self.failed
            || self.remaining == 0
            || !self
                .citations
                .sources
                .iter()
                .any(|source| source.url == url)
            || !self.budget.fetch()
        {
            return Ok(
                "This page cannot be read in this turn. Use the available search snippets.".into(),
            );
        }
        self.summary.active_url = Some(url.to_string());
        self.update(
            Some(WebEvent {
                name: "web_fetch:started",
                payload: json!({"turn_id":self.id,"url":url}),
            }),
            emit,
        )?;
        let page = match fetch_local::fetch(&url, self.remaining).await {
            Ok(page) => Ok(page),
            Err(_) if provider.capabilities().fetch => provider.fetch(&url).await,
            Err(error) => Err(error),
        };
        self.summary.active_url = None;
        let (name, text) = match page {
            Ok(page) => {
                let units = page.cost_units.unwrap_or(0);
                service.charge(units)?;
                self.summary.credits = self.summary.credits.saturating_add(units);
                let text: String = page.markdown.chars().take(self.remaining).collect();
                self.remaining = self.remaining.saturating_sub(text.chars().count());
                (
                    "web_fetch:completed",
                    format!("Untrusted page content from {url}:\n{text}"),
                )
            }
            Err(_) => (
                "web_fetch:failed",
                "This page could not be read. Use the available search snippets.".into(),
            ),
        };
        self.update(
            Some(WebEvent {
                name,
                payload: json!({"turn_id":self.id,"url":url}),
            }),
            emit,
        )?;
        Ok(text)
    }
    pub fn sources(&self) -> &[Source] {
        &self.citations.sources
    }
}
