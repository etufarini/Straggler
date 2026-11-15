import type { Delta } from '../domain/types';
import type { WebSearchStatus, WebSearchTurn, WebSource } from '../domain/webSearch';

// Deliberately synthetic: no keychain access, remote search, page request or inference.
export function createWebSearchFixture(scenario: string) {
  let saved = scenario.startsWith('web-') && scenario !== 'web-no-key';
  let used = scenario === 'web-low' ? 850 : scenario === 'web-exhausted' ? 1000 : 120;
  const limit = 1000;
  function status(): WebSearchStatus {
    return {
      providers: [
        {
          id: 'mock',
          name: 'Mock search',
          signupUrl: 'https://example.org/key',
          keyPlaceholder: 'demo-…',
          planDescription: 'Demonstration service. No remote requests are made.',
          searchCostDescription: 'about 1 simulated credit each',
        },
      ],
      selected: 'mock',
      saved,
      error: null,
      errorKind: null,
      quota: saved ? { used, limit, resets_on: '2026-12-01' } : null,
    };
  }
  function emit(name: string, payload: unknown) {
    window.dispatchEvent(new CustomEvent(`straggler-fixture-event:${name}`, { detail: payload }));
  }
  async function invoke(command: string, args: Record<string, unknown>) {
    if (command === 'web_search_status') return status();
    if (command === 'web_search_key_save') {
      if (args.key !== null && scenario === 'web-offline') throw new Error('offline');
      if (
        args.key !== null &&
        (scenario === 'web-invalid' || String(args.key).includes('rejected'))
      )
        throw new Error('invalid_credentials');
      saved = args.key !== null;
      return status();
    }
    if (command === 'open_web_url') {
      window.dispatchEvent(new CustomEvent('straggler-fixture-external-url', { detail: args.url }));
      return;
    }
    throw new Error(`Unexpected mock search command: ${command}`);
  }
  async function search(
    request: { requestId: string; webSearch?: boolean; webSearchQuery?: string },
    channel: { onmessage: (delta: Delta) => void },
  ): Promise<Partial<Delta>> {
    window.dispatchEvent(
      new CustomEvent('straggler-fixture-chat-web-enabled', { detail: request.webSearch === true }),
    );
    if (!request.webSearch) return {};
    const query = request.webSearchQuery || 'Demonstration query';
    const summary: WebSearchTurn = {
      queries: [query],
      credits: 0,
      fallback: scenario === 'web-no-tools',
      errors: [],
      activeQuery: query,
    };
    channel.onmessage({
      content: '',
      reasoning: '',
      webSearch: structuredClone(summary),
      sources: [],
    });
    emit('web_search:started', { turn_id: request.requestId, query });
    await new Promise((resolve) => setTimeout(resolve, 250));
    delete summary.activeQuery;
    const error = !saved
      ? 'not_configured'
      : scenario === 'web-offline'
        ? 'offline'
        : scenario === 'web-invalid'
          ? 'invalid_credentials'
          : scenario === 'web-exhausted'
            ? 'quota_exhausted'
            : null;
    const sources: WebSource[] = [];
    if (error) {
      summary.errors.push(error);
      emit('web_search:failed', { turn_id: request.requestId, error_kind: error });
    } else {
      summary.credits = 1;
      used += 1;
      sources.push(
        {
          n: 1,
          title: 'Simulated source: overview',
          url: 'https://example.org/overview',
          domain: 'example.org',
          published_at: '2026-11-10',
        },
        {
          n: 2,
          title: 'Simulated source: reference',
          url: 'https://example.com/reference',
          domain: 'example.com',
          published_at: null,
        },
      );
      window.dispatchEvent(new CustomEvent('straggler-fixture-web-request', { detail: { query } }));
      emit('web_search:completed', {
        turn_id: request.requestId,
        query,
        hits: sources,
        cached: false,
      });
    }
    const result = { webSearch: summary, sources };
    channel.onmessage({ content: '', reasoning: '', ...structuredClone(result) });
    emit('web_search:quota', { used, limit, resets_on: '2026-12-01' });
    return result;
  }
  return { invoke, search };
}
