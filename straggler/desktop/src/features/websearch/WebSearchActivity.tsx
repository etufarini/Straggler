import { LoaderCircle } from 'lucide-react';
import Feedback from '../../components/Feedback';
import { webSearchError } from '../../domain/webSearch';
import type { Message } from '../../domain/types';
import type { WebSearchController } from './useWebSearch';

export default function WebSearchActivity({
  message,
  search,
  onSettings,
}: {
  message: Message;
  search: WebSearchController;
  onSettings: () => void;
}) {
  const turn = message.webSearch;
  if (!turn) return null;
  const busy = message.status === 'streaming';
  const quota = search.status?.quota;
  return (
    <>
      {busy && (turn.activeQuery || turn.activeUrl) && (
        <p className="web-status" role="status">
          <LoaderCircle size={14} className="web-spinner" />
          {turn.activeQuery
            ? `Searching the web for “${turn.activeQuery}”…`
            : `Reading ${turn.activeUrl}…`}
        </p>
      )}
      {turn.queries.length > 0 && (
        <details className="reasoning web-search-activity">
          <summary>
            Searched the web · {turn.queries.length}{' '}
            {turn.queries.length === 1 ? 'search' : 'searches'} · {message.sources?.length ?? 0}{' '}
            sources · {turn.credits} {turn.credits === 1 ? 'credit' : 'credits'}
          </summary>
          <ul>
            {turn.queries.map((query, index) => (
              <li key={index}>{query}</li>
            ))}
          </ul>
          {turn.fallback && (
            <p className="field-help">
              This model can't call tools, so Straggler ran one search with your message and gave
              the results to the model.
            </p>
          )}
          {quota?.limit && quota.used / quota.limit >= 0.8 ? (
            <p className="field-help">
              {quota.used.toLocaleString('en-US')} of {quota.limit.toLocaleString('en-US')} credits
              used this month.
            </p>
          ) : null}
        </details>
      )}
      {turn.errors.map((error) => (
        <Feedback
          key={error}
          title={webSearchError(error, search.provider?.name)}
          severity="warning"
          actions={
            <button type="button" onClick={onSettings}>
              Open Web search settings
            </button>
          }
        >
          This answer continues without web search.
          {error === 'quota_exhausted' && quota?.resets_on
            ? ` Credits reset on ${quota.resets_on}.`
            : ''}
        </Feedback>
      ))}
    </>
  );
}
