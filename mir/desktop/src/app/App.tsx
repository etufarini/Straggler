import PresencePanel from '../features/presence/PresencePanel';
import { assistantState } from '../domain/presence';
import { Cpu, ChevronDown, Square, Terminal } from 'lucide-react';
import { fileName, equalSettings, sameServerConfiguration } from '../domain/types';
import { statusLabel } from '../components/statusLabels';
import { isFixture } from '../services/desktop';
import SettingsPage from '../features/settings/Settings';
import Sidebar from './Sidebar';
import ConfirmationDialog from './ConfirmationDialog';
import ChatPanel from '../features/chat/ChatPanel';
import ServerPanel from '../features/server/ServerPanel';
import ServerFeedback from '../features/server/ServerFeedback';
import StorageFeedback from '../features/chat/StorageFeedback';
import Feedback from '../components/Feedback';
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
    native,
    selected,
    job,
    config,
    start,
    error,
    setError,
    storageError,
    draft,
    panel,
    setDraft,
    acceptConfiguration,
    setJob,
    confirmation,
    requestStop,
    settingsSection,
    setSettingsSection,
    settingsFailure,
    setSettingsFailure,
    reportSettingsError,
  } = controller;
  const restartRequired = !!(
    active &&
    draft &&
    server.runningSettings &&
    !sameServerConfiguration(draft, server.runningSettings)
  );
  const lastResponse = controller.chat.messages
    .filter((message) => message.role === 'assistant')
    .at(-1);
  const presence = assistantState({
    serverPhase: server.phase,
    generating: controller.generating,
    generationPhase: controller.generationPhase,
    serverRunId: server.runId,
    responseRunId: lastResponse?.serverRunId,
    responseStatus: lastResponse?.status,
  });
  const modified = !!(
    draft &&
    config?.savedSettings &&
    !equalSettings(draft, config.savedSettings)
  );
  return (
    <div className="app-shell">
      <Sidebar controller={controller} />

      <main
        className={`workspace ${error || controller.preferenceError || storageError || server.issue || server.error || settingsFailure || lastResponse?.error ? 'has-feedback' : ''}`}
      >
        <header className="topbar">
          <button
            className="model-switch"
            aria-label="Choose model"
            aria-expanded={panel === 'models'}
            onClick={() => setPanel('models')}
          >
            <span className="model-icon">
              <Cpu size={17} />
            </span>
            <span>
              {displayModel ? fileName(displayModel) : 'Choose a local model'}
              {panel !== 'settings' && (
                <small>
                  {config?.currentProfile || 'Unsaved configuration'}
                  {modified ? ' · Modified' : ''}
                </small>
              )}
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="header-controls">
            <button
              className="local-badge"
              aria-label={`Server log · ${statusLabel[server.phase]}${restartRequired ? ' · Restart required' : ''}`}
              aria-expanded={panel === 'logs'}
              onClick={() => setPanel('logs')}
            >
              <span className={`status-dot ${server.phase}`} />
              {statusLabel[server.phase]}
              {restartRequired && server.phase !== 'needs-restart' && (
                <span className="restart-label">Restart required</span>
              )}
              <Terminal size={14} />
            </button>
            {active ? (
              <button disabled={busy || server.phase === 'stopping'} onClick={requestStop}>
                <Square size={14} />
                Stop server
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
        <ServerFeedback controller={controller} />
        {controller.preferenceError && (
          <div className="workspace-feedback">
            <Feedback
              title="Desktop preferences could not be saved"
              details={controller.preferenceError}
            >
              Your layout remains usable for this session.
            </Feedback>
          </div>
        )}

        {error && (
          <div className="workspace-feedback">
            <Feedback
              title="Could not complete the action"
              details={error}
              onDismiss={() => setError('')}
            >
              Review the details before trying again.
            </Feedback>
          </div>
        )}
        {(storageError || controller.fileError || controller.fileNotice) &&
          panel === 'settings' && (
            <div className="workspace-feedback">
              <StorageFeedback controller={controller} />
            </div>
          )}

        {panel === 'settings' && config && draft ? (
          <SettingsPage
            serverDetails={controller.serverDetails}
            config={config}
            draft={draft}
            setDraft={setDraft}
            server={server}
            job={job}
            accept={acceptConfiguration}
            confirm={setConfirmation}
            onError={reportSettingsError}
            onClearError={() => setSettingsFailure(null)}
            failure={settingsFailure}
            section={settingsSection}
            setSection={setSettingsSection}
            onBack={() => setPanel(null)}
            onJob={setJob}
          />
        ) : (
          <div className="chat-body">
            <div className="chat-main">
              <ChatPanel controller={controller} />
            </div>
            <PresencePanel
              state={presence}
              metrics={lastResponse?.metrics}
              preferences={controller.preferences}
              onPreferences={controller.changePreferences}
              ready={controller.preferencesReady}
            />
          </div>
        )}
      </main>

      {panel && panel !== 'settings' && <ServerPanel controller={controller} />}

      {confirmation && <ConfirmationDialog controller={controller} />}
    </div>
  );
}
