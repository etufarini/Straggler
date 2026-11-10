import {
  X,
  RefreshCw,
  CircleHelp,
  Folder,
  HardDrive,
  Check,
  Square,
  LoaderCircle,
  Cpu,
} from 'lucide-react';
import { fileName } from '../../domain/types';
import { statusLabel } from '../../components/statusLabels';
import type { WorkspaceController } from '../../app/useWorkspace';
import Feedback from '../../components/Feedback';
export default function ServerPanel({ controller }: { controller: WorkspaceController }) {
  const {
    setPanel,
    panel,
    native,
    busy,
    loadConfiguration,
    config,
    selected,
    active,
    setSelected,
    server,
    job,
    start,
    requestStop,
  } = controller;
  return (
    <div
      className="panel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPanel(null);
      }}
    >
      <section
        className={`panel ${panel === 'logs' ? 'log-panel' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={panel === 'models' ? 'Local models' : 'Server log'}
      >
        <div className="panel-heading">
          <div>
            <h2>{panel === 'models' ? 'Local models' : 'Server log'}</h2>
          </div>
          <button aria-label="Close panel" onClick={() => setPanel(null)}>
            <X size={20} />
          </button>
        </div>
        {panel === 'models' && (
          <>
            <p className="panel-intro">Choose a model from your models folder.</p>
            <button
              className="text-button"
              disabled={!native || busy}
              onClick={() => void loadConfiguration()}
            >
              <RefreshCw size={14} />
              Refresh models
            </button>
            {!config?.serverAvailable && (
              <div className="setup-callout">
                <CircleHelp size={19} />
                <div>
                  <strong>Set up llama.cpp first</strong>
                  <p>
                    Open Settings to install llama.cpp or select an existing build and choose your
                    Models folder.
                  </p>
                  <button onClick={() => setPanel('settings')}>Open Settings</button>
                </div>
              </div>
            )}
            {config?.warning && (
              <Feedback title="Folder settings need attention" severity="warning">
                {config.warning}
              </Feedback>
            )}
            {config?.models.length === 0 && (
              <div className="empty-models">
                <Folder size={28} />
                <h3>No GGUF models found</h3>
                <p>
                  Add a model to your configured folder, or choose another folder in Settings →
                  Folders.
                </p>
              </div>
            )}
            <div className="model-list">
              {config?.models.map((model) => (
                <button
                  key={model.path}
                  className={`model-option ${selected === model.path ? 'chosen' : ''}`}
                  disabled={active || busy}
                  onClick={() => setSelected(model.path)}
                >
                  <HardDrive size={20} />
                  <span>
                    {fileName(model.path)}
                    <small>{model.label}</small>
                  </span>
                  {selected === model.path && <Check size={17} />}
                </button>
              ))}
            </div>
            <p className="capability-note">
              What a model can do depends on the model and your llama.cpp version. Larger models
              need more memory.
            </p>
            <div className="panel-actions">
              {active ? (
                <button
                  className="danger-button"
                  disabled={busy || server.phase === 'stopping'}
                  onClick={requestStop}
                >
                  <Square size={14} />
                  Stop server
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={
                    !native ||
                    !config?.serverAvailable ||
                    !selected ||
                    busy ||
                    ['running', 'stopping'].includes(job.phase)
                  }
                  onClick={() => void start()}
                >
                  {busy ? <LoaderCircle size={15} className="spin" /> : <Cpu size={15} />}Load model
                </button>
              )}
            </div>
          </>
        )}
        {panel === 'logs' && (
          <>
            <div className="log-summary">
              <span className={`status-dot ${server.phase}`} />
              {statusLabel[server.phase]}
              <code>{server.url || 'No active endpoint'}</code>
            </div>
            <pre className="server-log" tabIndex={0}>
              {server.issue && `${server.issue.details}\n\n`}
              {server.logs.join('\n') || 'Server output will appear here when a model is loaded.'}
            </pre>
            <p className="capability-note">
              Latest 300 lines. Logs can include file paths, so check them before sharing.
            </p>
            {active && (
              <button
                className="danger-button"
                disabled={server.phase === 'stopping'}
                onClick={requestStop}
              >
                <Square size={14} />
                Stop server
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
