import { Cpu, ChevronDown, Square } from 'lucide-react';
import { fileName, equalSettings, displayValue } from '../domain/types';
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
              <button disabled={busy || server.phase === 'stopping'} onClick={requestStop}>
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
        <ServerFeedback controller={controller} />
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
        {storageError && panel === 'settings' && (
          <div className="workspace-feedback">
            <StorageFeedback controller={controller} />
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
            onError={reportSettingsError}
            onClearError={() => setSettingsFailure(null)}
            failure={settingsFailure}
            section={settingsSection}
            setSection={setSettingsSection}
            onStart={() => void start()}
            onStop={controller.stop}
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
