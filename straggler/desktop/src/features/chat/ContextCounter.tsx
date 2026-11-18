import Popover from '../../components/Popover';
import { currentContext } from '../../domain/chat';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function ContextCounter({ controller }: { controller: WorkspaceController }) {
  const reported = currentContext(
    controller.chat.messages,
    controller.serverDetails,
    controller.server,
  );
  const estimate = controller.contextEstimate;
  const estimated =
    !!controller.chat.attachments?.length &&
    !!estimate.capacity &&
    (!estimate.includesImages || !!controller.input || !reported);
  const usage = estimated
    ? {
        tokens: estimate.tokens,
        capacity: estimate.capacity!,
        percent: Math.round((estimate.tokens / estimate.capacity!) * 100),
        source: estimate.source,
        level:
          estimate.tokens / estimate.capacity! >= 0.9
            ? 'full'
            : estimate.tokens / estimate.capacity! >= 0.75
              ? 'high'
              : 'normal',
      }
    : reported;
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
      {() => (
        <>
          {estimate.includesImages && estimated && (
            <p className="popover-note" role="status">
              Includes images · estimate. Image tokens are reported after the response.
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
                  : 'Context is almost full. Start a new chat or increase the context size. At the limit, replies may stop; context shift, when enabled and supported, discards earlier context.'}
              </p>
              <p className="ctx-tech">
                {estimated
                  ? `${estimate.source === 'approximate' ? 'Approximate local estimate' : 'Estimated with llama-server tokenization'} of the prompt including attachments${estimate.templated ? ' and the chat template' : ''}.`
                  : `Last reported response ${usage.source === 'usage' ? 'usage' : 'timings'} from llama-server. After a context shift, response totals may include discarded context.`}
              </p>
            </>
          ) : (
            <p className="popover-note">
              {controller.serverDetails?.error || 'Available once the server is running.'}
            </p>
          )}
          <p className="ctx-tech">
            Window size comes from the running server <code>n_ctx</code>
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
