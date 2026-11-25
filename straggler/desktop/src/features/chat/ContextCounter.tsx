import { useId } from 'react';
import Popover from '../../components/Popover';
import { contextWindowUsage } from '../../domain/chat';
import { summarizeMessagesLabel } from '../../domain/compaction';
import type { CompactionResult } from '../../domain/compaction';
import type { WorkspaceController } from '../../app/useWorkspace';

const formatNumber = (value: number) => value.toLocaleString('en-US');

export function compactionResultLabel(result: CompactionResult, applied: boolean) {
  if (!applied) return 'No measurable space freed';
  const { before, after, approximate } = result;
  const difference = `${approximate ? '≈' : ''}${formatNumber(before - after)}`;
  return `Earlier messages summarized · ${difference} tokens freed`;
}

export default function ContextCounter({
  controller,
  onViewSummary,
  recoveryActions,
}: {
  controller: WorkspaceController;
  onViewSummary: () => void;
  recoveryActions: { label: string; run: () => void }[];
}) {
  const {
    available,
    tokens,
    usage,
    approximate,
    compaction,
    includesImages,
    searchFiles,
    searchWeb,
    templated,
    replyTarget,
    replyShortfall,
  } = controller.contextEstimate;
  const percent = usage ? `${approximate ? '≈' : ''}${usage.percent}%` : '—';
  const tokenCount = `${approximate ? '≈' : ''}${formatNumber(tokens)}`;
  const compactReason = controller.compactReason();
  const compactReasonId = useId();
  const comparison = compaction?.result;
  const showRecovery = replyShortfall > 0 || controller.contextEstimate.overflow;
  const beforeUsage =
    comparison && contextWindowUsage(comparison.before, compaction?.capacity ?? null);
  const afterUsage =
    comparison && contextWindowUsage(comparison.after, compaction?.capacity ?? null);
  return (
    <Popover
      label="Context"
      heading="Context for next message"
      valueLabel={
        !available
          ? 'Usage unavailable'
          : usage
            ? `${approximate ? 'About ' : ''}${usage.percent}% · ${formatNumber(tokens)} of ${formatNumber(usage.capacity)} tokens`
            : `${approximate ? 'About ' : ''}${formatNumber(tokens)} tokens · capacity unavailable`
      }
      className={`context-menu ctx-${usage?.level ?? 'unknown'}`}
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
          <span>{percent}</span>
        </>
      }
    >
      {(close) => (
        <>
          {available ? (
            <>
              <div className="ctx-figures">
                {usage && <b>{percent}</b>}
                <span>
                  {tokenCount}
                  {usage ? ` of ${formatNumber(usage.capacity)}` : ''} tokens
                </span>
              </div>
              {usage ? (
                <>
                  <progress
                    className="context-bar"
                    max={usage.capacity}
                    value={Math.min(tokens, usage.capacity)}
                    aria-label="Context for next message"
                  />
                  <p className="popover-note">
                    {approximate ? '≈' : ''}
                    {formatNumber(Math.abs(usage.remaining))} tokens{' '}
                    {usage.remaining < 0
                      ? 'over capacity'
                      : replyTarget
                        ? 'available for the reply'
                        : 'available'}
                  </p>
                  {replyTarget > 0 && replyShortfall > 0 && (
                    <p className="popover-note">
                      Free {approximate ? 'about ' : ''}
                      {formatNumber(replyShortfall)} tokens for a {formatNumber(replyTarget)}-token
                      reply.
                    </p>
                  )}
                </>
              ) : (
                <p className="popover-note">
                  {controller.cloud.active
                    ? 'This service does not list the model’s context size.'
                    : (controller.serverDetails?.error ??
                      'The local context capacity is unavailable.')}
                </p>
              )}
              <p className="ctx-tech">
                {templated
                  ? 'Estimated with llama-server tokenization and the chat template.'
                  : 'Approximate token count.'}{' '}
                {includesImages && 'Includes estimated image tokens. '}
                {searchFiles && 'File excerpts are selected on send. '}
                {searchWeb && 'Web search results may add tokens on send.'}
              </p>
              {showRecovery && (
                <details className="ctx-included">
                  <summary>Review what’s included</summary>
                  <ul>
                    <li>Applicable instructions and model formatting</li>
                    {controller.chat.messages.length > 0 && (
                      <li>Chat history{controller.chat.summary ? ' and summary' : ''}</li>
                    )}
                    {!!controller.currentProject?.files.some((file) => file.included) && (
                      <li>Included project files</li>
                    )}
                    {!!controller.chat.attachments?.some(
                      (file) => !file.image || includesImages,
                    ) && <li>Chat attachments</li>}
                    {controller.input.trim() && <li>Current draft</li>}
                  </ul>
                </details>
              )}
            </>
          ) : (
            !compactReason && (
              <p className="popover-note">
                Project data is unavailable. Reload the project to estimate context.
              </p>
            )
          )}
          {compaction && (
            <p className="popover-note ctx-compaction">
              <strong>{compactionResultLabel(compaction.result, compaction.applied)}</strong>
              {compaction.applied && comparison && beforeUsage && afterUsage && (
                <span>
                  {comparison.approximate ? '≈' : ''}
                  {beforeUsage.percent}% → {afterUsage.percent}%
                </span>
              )}
            </p>
          )}
          <div className="ctx-actions">
            {showRecovery &&
              !controller.canCompactDraft &&
              recoveryActions.map(({ label, run }) => (
                <button
                  key={label}
                  type="button"
                  className="text-button"
                  onClick={() => {
                    close();
                    run();
                  }}
                >
                  {label}
                </button>
              ))}
            {controller.chat.summary && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  close();
                  onViewSummary();
                }}
              >
                View summary
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!!compactReason}
              aria-describedby={compactReason ? compactReasonId : undefined}
              onClick={() => {
                close();
                void controller.compact();
              }}
            >
              {summarizeMessagesLabel(controller.chat.summary)}
            </button>
          </div>
          {compactReason && (
            <p className="popover-note" id={compactReasonId}>
              {compactReason}
            </p>
          )}
        </>
      )}
    </Popover>
  );
}
