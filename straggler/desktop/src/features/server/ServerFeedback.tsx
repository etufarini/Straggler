import Feedback from '../../components/Feedback';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function ServerFeedback({ controller }: { controller: WorkspaceController }) {
  const { server, setPanel, reviewSettings, requestStop, active } = controller;
  if (!server.issue && !server.error) return null;
  const memory = server.issue?.kind === 'memory';
  const stopped = !active;
  let title = 'The server stopped unexpectedly';
  let description = 'Your chat is kept. Check the server log and try again.';
  if (server.issue && stopped) {
    title = memory ? 'Server stopped after a memory error' : 'Server stopped after a backend error';
    description = memory
      ? 'Review context size and prompt processing before starting again.'
      : 'Review the server log before starting again.';
  } else if (server.issue) {
    title = memory ? 'Not enough memory' : 'The inference backend cannot continue';
    description = 'Stop the server and review its settings before restarting.';
  }
  return (
    <div className="workspace-feedback">
      <Feedback
        title={title}
        severity={stopped && server.issue ? 'warning' : 'error'}
        details={server.issue ? undefined : server.error || undefined}
        actions={
          <>
            {active ? (
              <button
                className="danger-button"
                disabled={server.phase === 'stopping'}
                onClick={requestStop}
              >
                {server.phase === 'stopping' ? 'Stopping…' : 'Stop server'}
              </button>
            ) : (
              <button className="primary-button" onClick={() => reviewSettings('model')}>
                Review settings
              </button>
            )}
            <button className="text-button" onClick={() => setPanel('logs')}>
              View log
            </button>
          </>
        }
      >
        {description}
      </Feedback>
    </div>
  );
}
