import { useEffect, useRef } from 'react';
import Feedback from '../../components/Feedback';
import type { ProjectContextState } from '../../domain/projectContext';

const number = (value: number) => value.toLocaleString('en-US');
export function ProjectCapacity({
  context,
  serverRunning,
}: {
  context: ProjectContextState;
  serverRunning: boolean;
}) {
  const { used, available, capacity, reserve, ratio, level, approximate } = context;
  const state =
    level === 'over' ? 'over the limit' : level === 'high' ? 'close to the limit' : 'fits';
  return (
    <div className="project-capacity">
      <div className="project-capacity-row">
        <span id="project-capacity-label">Context used by this project</span>
        <strong>
          {approximate ? '≈ ' : ''}
          {number(used)}
          {available !== null ? ` / ${number(available)}` : ' tokens'}
        </strong>
      </div>
      {available === null ? (
        <small>
          {serverRunning ? (
            <>
              <strong>Capacity unavailable</strong>: the running server has not reported its context
              size.{' '}
              {approximate
                ? 'Estimated: exact counts come from the running server.'
                : 'Counted by the running server.'}
            </>
          ) : (
            <>
              <strong>Estimate.</strong> Start the server for exact counts.
            </>
          )}
        </small>
      ) : (
        <>
          <div
            className={`project-meter is-${level}`}
            role="meter"
            aria-labelledby="project-capacity-label"
            aria-valuemin={0}
            aria-valuemax={available}
            aria-valuenow={Math.min(used, available)}
            aria-valuetext={`${approximate ? 'Approximately ' : ''}${number(used)} of ${number(available)} tokens, ${state}`}
            data-control-id="meter-project-context"
          >
            <span style={{ width: `${Math.min(ratio ?? 0, 1) * 100}%` }} />
          </div>
          <small>
            <strong>
              {Math.round((ratio ?? 0) * 100)}% · {state}.
            </strong>{' '}
            Instructions and included files, including filenames and delimiters.
          </small>
          <small>
            Window {number(capacity!)} tokens (n_ctx); {number(reserve!)} kept free for the chat and
            replies.{' '}
            {approximate
              ? 'Estimated: exact counts come from the running server.'
              : 'Counted by the running server.'}
          </small>
        </>
      )}
    </div>
  );
}

export function ProjectLimitFeedback({
  context,
  chat = false,
  onReviewFiles,
  onChangeContext,
}: {
  context: ProjectContextState;
  chat?: boolean;
  onReviewFiles: () => void;
  onChangeContext: () => void;
}) {
  const over = context.level === 'over';
  const previous = useRef(false);
  const announce = over && !previous.current;
  useEffect(() => {
    previous.current = over;
  }, [over]);
  if (!over) return null;
  return (
    <Feedback
      announce={context.search || announce}
      severity={context.search ? 'warning' : 'error'}
      title={
        context.search
          ? 'Search mode'
          : chat
            ? 'Project files exceed the context window'
            : 'This project does not fit in the context window'
      }
      actions={
        <>
          <button
            type="button"
            className="text-button"
            data-control-id="button-review-files"
            onClick={onReviewFiles}
          >
            Review files
          </button>
          <button
            type="button"
            className="text-button"
            data-control-id="button-change-context-size"
            onClick={onChangeContext}
          >
            Change context size in Settings
          </button>
        </>
      }
    >
      {context.search ? (
        'Too large for one chat, so Straggler searches these files for each message and uses the most relevant passages.'
      ) : (
        <>
          Its instructions and included files need {number(context.used)} tokens;{' '}
          {number(context.available!)} are available. The project needs {number(context.shortfall)}{' '}
          more tokens than are available. Chats in this project cannot send messages until it fits.
        </>
      )}
    </Feedback>
  );
}
