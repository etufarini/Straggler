//! Evidence reported by the supervised server, independent of hardware discovery.
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueKind {
    Memory,
    Backend,
}

#[derive(Clone, Debug, Serialize)]
pub struct ServerIssue {
    pub kind: IssueKind,
    pub details: String,
}

#[derive(Default)]
pub(crate) struct Diagnostics {
    pub issue: Option<ServerIssue>,
    pub failed: CancellationToken,
    memory_error: Option<Instant>,
}

impl Diagnostics {
    pub fn observe_log(&mut self, line: &str) {
        let text = line.to_ascii_lowercase();
        if memory_error(&text) {
            self.memory_error = Some(Instant::now());
        }
        // An allocation warning can be followed by a successful fallback. Only
        // explicit backend failure or a failed request makes recovery mandatory.
        if backend_failed(&text) {
            self.record_failure(line, self.recent_memory_error());
        }
    }

    pub fn request_failed(&mut self, detail: &str) {
        let text = detail.to_ascii_lowercase();
        let memory =
            memory_error(&text) || (text.contains("compute error") && self.recent_memory_error());
        if memory || backend_failed(&text) {
            self.record_failure(detail, memory);
        }
    }

    pub fn process_failed(&mut self, detail: &str) {
        if self.recent_memory_error() {
            self.record_failure(detail, true);
        }
    }

    fn recent_memory_error(&self) -> bool {
        self.memory_error
            .is_some_and(|time| time.elapsed() <= Duration::from_secs(10))
    }

    fn record_failure(&mut self, detail: &str, memory: bool) {
        // A second, less specific error must not replace the original evidence.
        if self.issue.is_none() {
            self.issue = Some(ServerIssue {
                kind: if memory {
                    IssueKind::Memory
                } else {
                    IssueKind::Backend
                },
                details: detail.chars().take(16384).collect(),
            });
        }
        self.failed.cancel();
    }
}

fn memory_error(text: &str) -> bool {
    text.contains("out of memory")
        || text.contains("outofmemory")
        || text.contains("insufficient memory")
        || text.contains("out_of_memory")
        || text.contains("out_of_device_memory")
        || text.contains("out_of_host_memory")
}

fn backend_failed(text: &str) -> bool {
    text.contains("backend is in error state") || text.contains("recreate the backend to recover")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovered_allocation_and_unknown_compute_error_do_not_block_requests() {
        let mut diagnostics = Diagnostics::default();
        diagnostics.observe_log("warning: out of memory, retrying allocation");
        assert!(diagnostics.issue.is_none());
        assert!(!diagnostics.failed.is_cancelled());
        let mut unknown = Diagnostics::default();
        unknown.request_failed("Compute error.");
        assert!(unknown.issue.is_none());
        diagnostics.memory_error = Some(Instant::now() - Duration::from_secs(11));
        diagnostics.request_failed("Compute error.");
        assert!(diagnostics.issue.is_none());
    }

    #[test]
    fn explicit_failure_uses_recent_memory_evidence_and_keeps_the_first_issue() {
        let mut diagnostics = Diagnostics::default();
        diagnostics
            .observe_log("Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)");
        diagnostics.observe_log("backend is in error state from a previous command buffer failure - recreate the backend to recover");
        assert_eq!(diagnostics.issue.as_ref().unwrap().kind, IssueKind::Memory);
        assert!(diagnostics.failed.is_cancelled());
        let details = diagnostics.issue.as_ref().unwrap().details.clone();
        diagnostics.request_failed("Compute error.");
        assert_eq!(diagnostics.issue.unwrap().details, details);
        let fresh = Diagnostics::default();
        assert!(fresh.issue.is_none());
        assert!(!fresh.failed.is_cancelled());
    }

    #[test]
    fn request_errors_use_the_same_memory_category_for_different_backends() {
        for detail in [
            "CUDA error: out of memory",
            "VK_ERROR_OUT_OF_DEVICE_MEMORY",
            "VK_ERROR_OUT_OF_HOST_MEMORY",
            "Insufficient memory",
        ] {
            let mut diagnostics = Diagnostics::default();
            diagnostics.request_failed(detail);
            assert_eq!(diagnostics.issue.unwrap().kind, IssueKind::Memory);
        }
        let mut diagnostics = Diagnostics::default();
        diagnostics.observe_log("backend is in error state");
        assert_eq!(diagnostics.issue.unwrap().kind, IssueKind::Backend);
    }
}
