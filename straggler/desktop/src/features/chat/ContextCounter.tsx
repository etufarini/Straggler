import Popover from '../../components/Popover';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function ContextCounter({ controller }: { controller: WorkspaceController }) {
  const estimate = controller.contextEstimate;
  const usage = controller.contextUsage;
  const estimated = controller.contextEstimated;
  const label = usage
    ? usage.level === 'full'
      ? 'Almost full'
      : usage.level === 'high'
        ? 'Getting full'
        : 'Plenty of room'
    : 'Unavailable';
  return (
    <Popover
      label="Context"
      valueLabel={
        usage
          ? `${usage.percent}% · ${label} · ${usage.tokens} of ${usage.capacity} tokens`
          : 'Usage unavailable'
      }
      className={`context-menu ctx-${usage?.level || 'unknown'}`}
      trigger={
        <>
          <svg className="context-ring" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <circle
              cx="12"
              cy="12"
              r="9"
              pathLength="100"
              strokeDasharray={`${Math.min(100, usage?.percent ?? 0)} 100`}
            />
          </svg>
          <span>{usage ? `${usage.percent}%` : '—'}</span>
          <span className="visually-hidden">{label}</span>
        </>
      }
    >
      {(close) => (
        <>
          {estimate.includesImages && estimated && (
            <p className="popover-note" role="status">
              Includes images (estimate). Image tokens are counted after the response.
            </p>
          )}
          <p className="popover-note">How much of the model’s working memory this chat uses.</p>
          {usage ? (
            <>
              <div className="ctx-figures">
                <b>{usage.percent}%</b>
                <span>
                  {usage.tokens.toLocaleString('en-US')} of {usage.capacity.toLocaleString('en-US')}{' '}
                  tokens
                </span>
              </div>
              <progress
                className="context-bar"
                max={usage.capacity}
                value={Math.min(usage.tokens, usage.capacity)}
                aria-label="Context usage"
              />
              <p className="popover-note">
                {usage.level === 'normal'
                  ? 'Plenty of room left.'
                  : `Context is almost full. Compact earlier messages, start a new chat or increase the context size. ${controller.temporary ? 'Original messages stay in this temporary chat.' : 'Original messages stay saved.'} At the limit, replies may stop; context shift, when enabled and supported, discards earlier context.`}
              </p>
              <p className="ctx-tech">
                {estimated
                  ? `${estimate.source === 'approximate' ? (controller.cloud.active ? 'Approximate estimate' : 'Approximate local estimate') : 'Estimated with llama-server tokenization'} of the prompt including attachments${estimate.templated ? ' and the chat template' : ''}.`
                  : controller.cloud.active
                    ? `Last response usage reported by ${controller.cloud.active.providerName}.`
                    : `Last reported response ${usage.source === 'usage' ? 'usage' : 'timings'} from llama-server. After a context shift, response totals may include discarded context.`}
              </p>
            </>
          ) : (
            <p className="popover-note">
              {controller.serverDetails?.error ||
                (controller.cloud.active
                  ? 'This service does not list the model’s context size.'
                  : 'Available once the server is running.')}
            </p>
          )}
          <button
            className="text-button"
            disabled={!!controller.compactReason()}
            title={controller.compactReason()}
            onClick={() => {
              close();
              void controller.compact();
            }}
          >
            Compact chat
          </button>
          {controller.compactReason() && (
            <p className="popover-note">{controller.compactReason()}</p>
          )}
          <p className="ctx-tech">
            {controller.cloud.active ? (
              'Window size is advertised by the cloud service'
            ) : (
              <>
                Context size comes from the running server. <code>n_ctx</code>
              </>
            )}
            {controller.serverDetails?.contextSize
              ? `: ${controller.serverDetails.contextSize.toLocaleString('en-US')} tokens`
              : ' · unavailable'}
            .
          </p>
        </>
      )}
    </Popover>
  );
}
