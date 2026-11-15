use super::types::*;
use std::{
    collections::{HashMap, VecDeque},
    time::{Duration, Instant},
};

const CACHE_TTL: Duration = Duration::from_secs(15 * 60);
#[derive(Default)]
pub struct Budget {
    cache: HashMap<(ProviderId, SearchRequest), (Instant, SearchResponse)>,
    pub quota: Option<QuotaStatus>,
    quota_reads: VecDeque<Instant>,
    cooldowns: HashMap<ProviderId, Instant>,
}
impl Budget {
    fn key(provider: &ProviderId, request: &SearchRequest) -> (ProviderId, SearchRequest) {
        let mut request = request.clone();
        request.query = request
            .query
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        request.include_domains.sort();
        request.include_domains.dedup();
        request.exclude_domains.sort();
        request.exclude_domains.dedup();
        (provider.clone(), request)
    }
    pub fn cached(
        &mut self,
        provider: &ProviderId,
        request: &SearchRequest,
    ) -> Option<SearchResponse> {
        self.cache.retain(|_, (time, _)| time.elapsed() < CACHE_TTL);
        self.cache
            .get(&Self::key(provider, request))
            .map(|(_, response)| {
                let mut response = response.clone();
                response.query = request.query.clone();
                response.cost_units = Some(0);
                response
            })
    }
    pub fn remember(&mut self, request: &SearchRequest, response: SearchResponse) {
        self.charge(response.cost_units.unwrap_or(0));
        if self.cache.len() >= 128 {
            self.cache.clear();
        }
        self.cache.insert(
            Self::key(&response.provider, request),
            (Instant::now(), response),
        );
    }
    pub fn retry_after(&mut self, provider: &ProviderId) -> Option<u32> {
        let until = *self.cooldowns.get(provider)?;
        let remaining = until.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            self.cooldowns.remove(provider);
            return None;
        }
        Some(remaining.as_secs().saturating_add(1).min(u32::MAX as u64) as u32)
    }
    pub fn rate_limited(&mut self, provider: ProviderId, seconds: Option<u32>) {
        if let Some(until) =
            Instant::now().checked_add(Duration::from_secs(seconds.unwrap_or(60) as u64))
        {
            self.cooldowns.insert(provider, until);
        }
    }
    pub fn charge(&mut self, units: u32) {
        if let Some(quota) = &mut self.quota {
            quota.used = quota.used.saturating_add(units);
        }
    }
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
    pub fn clear(&mut self) {
        self.cache.clear();
        self.quota = None;
    }
    pub fn allow_quota_read(&mut self) -> bool {
        let now = Instant::now();
        self.quota_reads
            .retain(|time| now.duration_since(*time) < Duration::from_secs(600));
        if self.quota_reads.len() >= 10 {
            return false;
        }
        self.quota_reads.push_back(now);
        true
    }
}
pub struct TurnBudget {
    searches: u8,
    limit: u8,
    fetches: u8,
}
impl TurnBudget {
    pub fn new(limit: u8) -> Self {
        Self {
            searches: 0,
            limit: limit.clamp(1, 5),
            fetches: 0,
        }
    }
    pub fn search(&mut self) -> bool {
        if self.searches >= self.limit {
            return false;
        }
        self.searches += 1;
        true
    }
    pub fn fetch(&mut self) -> bool {
        if self.fetches >= 5 {
            return false;
        }
        self.fetches += 1;
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits_cache_expiry_filters_and_quota() {
        let mut turn = TurnBudget::new(3);
        assert!(turn.search());
        assert!(turn.search());
        assert!(turn.search());
        assert!(!turn.search());
        for _ in 0..5 {
            assert!(turn.fetch());
        }
        assert!(!turn.fetch());
        let id = ProviderId("test".into());
        let request = SearchRequest {
            query: "  Hello   WORLD ".into(),
            ..Default::default()
        };
        let response = SearchResponse {
            query: request.query.clone(),
            hits: vec![],
            provider: id.clone(),
            elapsed_ms: 1,
            cost_units: Some(1),
        };
        let mut budget = Budget {
            quota: Some(QuotaStatus {
                used: 2,
                limit: Some(10),
                resets_on: None,
            }),
            ..Default::default()
        };
        budget.remember(&request, response);
        assert_eq!(budget.quota.as_ref().unwrap().used, 3);
        let same = SearchRequest {
            query: "hello world".into(),
            ..Default::default()
        };
        assert_eq!(budget.cached(&id, &same).unwrap().cost_units, Some(0));
        assert!(budget.cached(&ProviderId("other".into()), &same).is_none());
        assert!(budget
            .cached(
                &id,
                &SearchRequest {
                    recency: Some(Recency::Day),
                    ..same.clone()
                }
            )
            .is_none());
        budget.cache.values_mut().next().unwrap().0 = Instant::now() - CACHE_TTL;
        assert!(budget.cached(&id, &same).is_none());
        budget.rate_limited(id.clone(), Some(60));
        assert!(budget.retry_after(&id).is_some_and(|seconds| seconds <= 61));
        budget
            .cooldowns
            .insert(id.clone(), Instant::now() - Duration::from_secs(1));
        assert!(budget.retry_after(&id).is_none());
        for _ in 0..10 {
            assert!(budget.allow_quota_read());
        }
        assert!(!budget.allow_quota_read());
    }
}
