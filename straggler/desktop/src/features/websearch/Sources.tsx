import type { WebSource } from '../../domain/webSearch';
import WebLink from './WebLink';

export default function Sources({
  sources,
  compact = false,
}: {
  sources: WebSource[];
  compact?: boolean;
}) {
  return (
    <section
      className={compact ? 'presence-section web-sources-panel' : 'message-sources'}
      aria-label={compact ? 'Latest response sources' : 'Sources'}
    >
      <div className="presence-section-heading">
        <h2>Sources</h2>
        {compact && <span className="attachments-summary">{sources.length || 'None'}</span>}
      </div>
      {sources.length ? (
        <ol className="web-source-list">
          {sources.map((source) => (
            <li key={source.n} value={source.n}>
              <span className="source-number">{source.n}</span>
              <span>
                <WebLink url={source.url}>{source.title}</WebLink>
                <small>
                  {source.domain}
                  {source.published_at ? ` · ${source.published_at}` : ''}
                </small>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="presence-empty">Sources appear here when a response uses web search.</p>
      )}
    </section>
  );
}
