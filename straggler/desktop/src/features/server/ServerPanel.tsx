import MemoryBadge from '../../components/MemoryBadge';
import { memoryEstimateNote } from '../../domain/memory';
import ServerMemory from './ServerMemory';
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
import { useState } from 'react';
import HuggingFaceBrowser from '../huggingface/HuggingFaceBrowser';
import HubDownloads from '../huggingface/HubDownloads';
import ModelsFolderActions from '../huggingface/ModelsFolderActions';
export default function ServerPanel({ controller }: { controller: WorkspaceController }) {
  const [modelsTab, setModelsTab] = useState<'local' | 'huggingface'>('local');
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
        aria-label={panel === 'models' ? 'Models' : 'Server log'}
      >
        <div className="panel-heading">
          <div>
            <h2>{panel === 'models' ? 'Models' : 'Server log'}</h2>
          </div>
          <button aria-label="Close panel" onClick={() => setPanel(null)}>
            <X size={20} />
          </button>
        </div>
        {panel === 'models' && (
          <>
            <div className="hf-tabs" role="tablist" aria-label="Model sources">
              {(['local', 'huggingface'] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={modelsTab === tab}
                  aria-controls={`models-tabpanel-${tab}`}
                  id={`models-tab-${tab}`}
                  tabIndex={modelsTab === tab ? 0 : -1}
                  onClick={() => setModelsTab(tab)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      const next = tab === 'local' ? 'huggingface' : 'local';
                      setModelsTab(next);
                      document.getElementById(`models-tab-${next}`)?.focus();
                    }
                  }}
                >
                  {tab === 'local' ? 'On this computer' : 'Hugging Face'}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`models-tabpanel-${modelsTab}`}
              aria-labelledby={`models-tab-${modelsTab}`}
            >
              {modelsTab === 'huggingface' ? (
                <HuggingFaceBrowser
                  controller={controller.huggingFace}
                  config={config}
                  onConfigured={controller.acceptConfiguration}
                  onTokenSettings={() => controller.reviewSettings('huggingface')}
                />
              ) : (
                <>
                  <p className="panel-intro">Choose a model from your models folder.</p>
                  {!config?.modelsDir && (
                    <ModelsFolderActions path="" onConfigured={controller.acceptConfiguration} />
                  )}
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
                          Open Settings to select a llama.cpp build and choose your Models folder.
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
                        Add a model to your configured folder, or choose another folder in Settings
                        → Folders.
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
                          <MemoryBadge
                            bytes={model.sizeBytes}
                            memory={config.memory}
                            context={controller.draft?.context}
                          />
                          {controller.server.model === model.path &&
                          controller.serverDetails?.visionSupported ? (
                            <small>Vision</small>
                          ) : model.projector ? (
                            <small>Vision · restart to enable</small>
                          ) : null}
                        </span>
                        {selected === model.path && <Check size={17} />}
                      </button>
                    ))}
                  </div>
                  <p className="capability-note">{memoryEstimateNote}</p>
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
                        disabled={!native || !config?.serverAvailable || !selected || busy}
                        onClick={() => void start()}
                      >
                        {busy ? <LoaderCircle size={15} className="spin" /> : <Cpu size={15} />}Load
                        model
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
            <HubDownloads controller={controller.huggingFace} />
          </>
        )}
        {panel === 'logs' && (
          <>
            <div className="log-summary">
              <span className={`status-dot ${server.phase}`} />
              {statusLabel[server.phase]}
              <code>{server.url || 'No active endpoint'}</code>
            </div>
            <ServerMemory controller={controller} />
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
