export interface WebSource {
  n: number;
  title: string;
  url: string;
  domain: string;
  published_at?: string | null;
}
export interface WebSearchTurn {
  queries: string[];
  credits: number;
  fallback: boolean;
  errors: string[];
  activeQuery?: string;
  activeUrl?: string;
}
export interface WebQuota {
  used: number;
  limit: number | null;
  resets_on: string | null;
}
export interface SearchProviderInfo {
  id: string;
  name: string;
  signupUrl: string;
  keyPlaceholder: string;
  planDescription: string;
  searchCostDescription: string;
}
export interface WebSearchStatus {
  providers: SearchProviderInfo[];
  selected: string;
  saved: boolean;
  error: string | null;
  errorKind: string | null;
  quota: WebQuota | null;
}
export function webSearchError(kind: string, provider = 'The search service'): string {
  switch (kind) {
    case 'offline':
      return "You're offline";
    case 'invalid_credentials':
      return `${provider} didn't accept the API key`;
    case 'quota_exhausted':
      return `This month’s ${provider} credits are used up`;
    case 'not_configured':
      return 'Web search needs an API key';
    case 'rate_limited':
      return 'The search service has limited requests. Try again later.';
    case 'timeout':
      return 'The web search timed out';
    case 'provider_unavailable':
      return 'The search service is unavailable';
    case 'invalid_request':
      return 'The search service could not run this query';
    default:
      return kind;
  }
}
export function sourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
