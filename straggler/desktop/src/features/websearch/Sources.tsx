import type { ProjectPassage } from '../../domain/types';
import type { WebSource } from '../../domain/webSearch';
import WebLink from './WebLink';

export default function Sources({
  sources = [],
  projectSources = [],
  onProjectSource,
  compact = false,
}: {
  sources?: WebSource[];
  projectSources?: ProjectPassage[];
  onProjectSource?: (source: ProjectPassage) => void;
  compact?: boolean;
}) {
  const count = sources.length + projectSources.length;
  return (
    <section
      className={compact ? 'presence-section web-sources-panel' : 'message-sources'}
      aria-label={compact ? 'Latest response sources' : 'Sources'}
    >
      <div className="presence-section-heading">
        <h2>Sources</h2>
        {compact && <span className="attachments-summary">{count || 'None'}</span>}
      </div>
      {count ? (
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
          {projectSources.map((source) => (
            <li key={`P${source.n}`}>
              <span className="source-number">P{source.n}</span>
              <button
                type="button"
                className="text-button project-source-link"
                onClick={() => onProjectSource?.(source)}
              >
                {source.name} · section {source.section}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="presence-empty">Web search sources appear here.</p>
      )}
    </section>
  );
}
