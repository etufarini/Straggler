import { Cpu, ChevronDown, Square, X } from 'lucide-react';
import { fileName, equalSettings, displayValue } from '../domain/types';
import { statusLabel } from '../components/statusLabels';
import { isFixture } from '../services/desktop';
import SettingsPage from '../features/settings/Settings';
import Sidebar from './Sidebar';
import ConfirmationDialog from './ConfirmationDialog';
import ChatPanel from '../features/chat/ChatPanel';
import ServerPanel from '../features/server/ServerPanel';
import { useWorkspace } from './useWorkspace';
export default function App() {
  const controller = useWorkspace();
  const {
    setPanel,
    displayModel,
    server,
    active,
    busy,
    setConfirmation,
    stop,
    native,
    selected,
    job,
    config,
    start,
    error,
    setError,
    storageError,
    chat,
    save,
    loadHistory,
    draft,
    panel,
    setDraft,
    acceptConfiguration,
    setJob,
    confirmation,
  } = controller;
  return (
    <div className="app-shell">
      <Sidebar controller={controller} />

      <main className="workspace">
        <header className="topbar">
          <button className="model-switch" onClick={() => setPanel('models')}>
            <span className="model-icon">
              <Cpu size={17} />
            </span>
            <span>
              {displayModel ? fileName(displayModel) : 'Choose a local model'}
              <small>
                {server.phase === 'ready'
                  ? 'Running on your device'
                  : 'Your models. Your conversations.'}
              </small>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="header-controls">
            <span className="local-badge">
              <span className={`status-dot ${server.phase}`} />
              {statusLabel[server.phase]}
            </span>
            {active ? (
              <button
                disabled={busy || server.phase === 'stopping'}
                onClick={() =>
                  setConfirmation({
                    title: 'Stop server?',
                    text: 'Shut down the local server? Conversations are kept.',
                    action: stop,
                  })
                }
              >
                <Square size={14} />
                Stop
              </button>
            ) : (
              <button
                className="primary-button"
                disabled={
                  !native ||
                  !selected ||
                  busy ||
                  ['running', 'stopping'].includes(job.phase) ||
                  !config?.serverAvailable
                }
                onClick={() => void start()}
              >
                Launch server
              </button>
            )}
          </div>
        </header>

        {isFixture() && (
          <div className="notice">
            Development scenario · simulated services and responses · no inference
          </div>
        )}
        {!native && (
          <div className="notice">
            This is the interface preview. Start the desktop app with <code>bash mir/mir.sh</code>{' '}
            to use local models.
          </div>
        )}
        {(error || server.error) && (
          <div role="alert" className="notice error">
            <span>{error || server.error}</span>
            <button aria-label="View server log" onClick={() => setPanel('logs')}>
              View log
            </button>
            {error && (
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={15} />
              </button>
            )}
          </div>
        )}
        {storageError && (
          <div role="alert" className="notice error">
            <span>{storageError} Your current text remains in this window.</span>
            <button
              onClick={() => {
                if (chat.messages.length) void save(chat).catch(() => {});
                else void loadHistory();
              }}
            >
              Retry saving
            </button>
          </div>
        )}

        {config && draft && (
          <div className="configuration-strip">
            <span>
              Configuration: {config.currentProfile || 'Not saved'}
              {config.savedSettings && !equalSettings(draft, config.savedSettings)
                ? ' · Modified'
                : ''}
            </span>
            <span>
              Context: {displayValue((active ? server.runningSettings : draft)?.context || 'auto')}
            </span>
            <span>
              Device: {displayValue((active ? server.runningSettings : draft)?.device || 'auto')}
            </span>
            <span>Port: {active ? server.runningSettings?.port || config.port : draft.port}</span>
            {active && server.runningSettings && !equalSettings(draft, server.runningSettings) && (
              <b>Restart required</b>
            )}
          </div>
        )}
        {panel === 'settings' && config && draft ? (
          <SettingsPage
            config={config}
            draft={draft}
            setDraft={setDraft}
            server={server}
            job={job}
            accept={acceptConfiguration}
            confirm={setConfirmation}
            onError={setError}
            onStart={() => void start()}
            onStop={stop}
            onBack={() => setPanel(null)}
            onJob={setJob}
          />
        ) : (
          <ChatPanel controller={controller} />
        )}
      </main>

      {panel && panel !== 'settings' && <ServerPanel controller={controller} />}

      {confirmation && <ConfirmationDialog controller={controller} />}
    </div>
  );
}
