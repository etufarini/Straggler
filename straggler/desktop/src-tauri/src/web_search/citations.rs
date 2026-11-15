use super::types::*;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub struct Source {
    pub n: u32,
    pub title: String,
    pub url: Url,
    pub domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SourceHit {
    #[serde(flatten)]
    pub source: Source,
    pub favicon_url: Option<Url>,
}
#[derive(Default)]
pub struct Citations {
    pub sources: Vec<Source>,
}
impl Citations {
    pub fn register(&mut self, hits: &[SearchHit]) -> Vec<SourceHit> {
        hits.iter()
            .map(|hit| {
                let source = match self.sources.iter().find(|source| source.url == hit.url) {
                    Some(source) => source.clone(),
                    None => {
                        let source = Source {
                            n: self.sources.len() as u32 + 1,
                            title: hit.title.clone(),
                            url: hit.url.clone(),
                            domain: hit.domain.clone(),
                            published_at: hit.published_at.clone(),
                        };
                        self.sources.push(source.clone());
                        source
                    }
                };
                SourceHit {
                    source,
                    favicon_url: hit.favicon_url.clone(),
                }
            })
            .collect()
    }
    pub fn contains(&self, n: u32) -> bool {
        self.sources.iter().any(|source| source.n == n)
    }
}
pub fn validate_sources(sources: &[Source]) -> crate::Result<()> {
    let mut numbers = std::collections::HashSet::new();
    for source in sources {
        if source.n == 0
            || !numbers.insert(source.n)
            || validate_url(&source.url).is_err()
            || source.url.host_str() != Some(source.domain.as_str())
            || source.title.chars().count() > 4096
        {
            return Err("Invalid web source in conversation.".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_numbers_are_unique_across_searches_and_unknown_citations_stay_unresolved() {
        let a = SearchHit::new(
            "A".into(),
            Url::parse("https://example.org/a").unwrap(),
            "A",
        )
        .unwrap();
        let b = SearchHit::new(
            "B".into(),
            Url::parse("https://example.org/b").unwrap(),
            "B",
        )
        .unwrap();
        let mut citations = Citations::default();
        assert_eq!(citations.register(std::slice::from_ref(&a))[0].source.n, 1);
        let next = citations.register(&[a, b]);
        assert_eq!(next[0].source.n, 1);
        assert_eq!(next[1].source.n, 2);
        assert!(citations.contains(2));
        assert!(!citations.contains(3));
        validate_sources(&citations.sources).unwrap();
    }
}
