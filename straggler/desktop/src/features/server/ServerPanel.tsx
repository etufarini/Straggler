import CloudModels from '../cloud/CloudModels';
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
  Cloud,
  Info,
  Search,
  ArrowLeft,
} from 'lucide-react';
import { fileName } from '../../domain/types';
import { statusLabel } from '../../components/statusLabels';
import type { WorkspaceController } from '../../app/useWorkspace';
import Feedback from '../../components/Feedback';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CloudSelection, ModelSelection } from '../../domain/cloudModels';
import { shownCloudModels } from '../../domain/cloudModels';
import HuggingFaceBrowser from '../huggingface/HuggingFaceBrowser';
import HubDownloads from '../huggingface/HubDownloads';
import ModelsFolderActions from '../huggingface/ModelsFolderActions';
export default function ServerPanel({ controller }: { controller: WorkspaceController }) {
  const [view, setView] = useState<'models' | 'downloads'>('models');
  const [query, setQuery] = useState('');
  const [cloudSelection, setCloudSelection] = useState<CloudSelection | null>(
    controller.cloud.active?.selection ?? null,
  );
  const download = useRef<HTMLButtonElement>(null);
  const downloadTitle = useRef<HTMLHeadingElement>(null);
  const modelPanel = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  useLayoutEffect(() => {
    if (controller.panel !== 'models') return;
    // Complete view-transition focus before the view accepts typing. The modal
    // controller owns initial Search models focus and restoration to its opener.
    if (view === 'downloads') downloadTitle.current?.focus();
    else if (previousView.current === 'downloads') download.current?.focus();
    else
      modelPanel.current
        ?.querySelector('[data-in-use="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    previousView.current = view;
  }, [view, controller.panel]);
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
  const selection: ModelSelection = cloudSelection
    ? { kind: 'cloud', ...cloudSelection }
    : { kind: 'local', path: selected };
  const needle = query.trim().toLocaleLowerCase();
  const matches = (name: string, provider: string) =>
    `${name} ${provider}`.toLocaleLowerCase().includes(needle);
  const localModels =
    config?.models.filter((model) =>
      matches(`${fileName(model.path)} ${model.label}`, 'On this computer llama.cpp'),
    ) ?? [];
  const groups = controller.cloud.status.providers
    .filter((provider) => provider.saved)
    .map((provider) => ({
      provider,
      models: shownCloudModels(provider).filter((model) => matches(model.name, provider.name)),
    }))
    .filter((group) => !needle || group.models.length > 0);
  const selectedProvider =
    selection.kind === 'cloud'
      ? controller.cloud.status.providers.find((provider) => provider.id === selection.providerId)
      : undefined;
  const inUse =
    selection.kind === 'cloud'
      ? controller.cloud.active?.selection.providerId === selection.providerId &&
        controller.cloud.active.selection.modelId === selection.modelId
      : active && server.model === selection.path;
  function selectionConsequence() {
    if (inUse) return 'Already in use.';
    if (selection.kind === 'cloud') {
      if (active) return 'Stops the local server and frees its memory.';
      return `Messages go to ${selectedProvider?.name ?? 'the selected service'}.`;
    }
    if (active) return 'Stop the server to choose another model on this computer.';
    return memoryEstimateNote;
  }
  async function useSelectedModel() {
    if (selection.kind === 'local') await start();
    else {
      // The cloud controller presents activation errors in its existing feedback.
      await controller
        .useCloudModel({ providerId: selection.providerId, modelId: selection.modelId })
        .catch(() => {});
    }
  }
  const unavailable =
    busy || controller.generating || controller.cloud.busy || !!controller.cloud.notice;
  return (
    <div
      className="panel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPanel(null);
      }}
    >
      <section
        ref={modelPanel}
        className={`panel ${panel === 'logs' ? 'log-panel' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={panel === 'models' ? 'Models' : 'Server log'}
      >
        <div className="panel-heading">
          <div>
            <h2 ref={downloadTitle} tabIndex={-1}>
              {panel === 'models'
                ? view === 'downloads'
                  ? 'Download models'
                  : 'Models'
                : 'Server log'}
            </h2>
          </div>
          <button aria-label="Close panel" onClick={() => setPanel(null)}>
            <X size={20} />
          </button>
        </div>
        {panel === 'models' && (
          <>
            {view === 'downloads' ? (
              <>
                <button className="text-button model-back" onClick={() => setView('models')}>
                  <ArrowLeft size={14} />
                  Back to models
                </button>
                <HuggingFaceBrowser
                  controller={controller.huggingFace}
                  config={config}
                  onConfigured={controller.acceptConfiguration}
                  onTokenSettings={() => controller.reviewSettings('huggingface')}
                />
              </>
            ) : (
              <>
                <label className="model-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    data-initial-focus
                    aria-label="Search models"
                    placeholder="Search models"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                {needle && !localModels.length && !groups.some((group) => group.models.length) && (
                  <p role="status">No models match ‘{query}’</p>
                )}
                {(!needle || localModels.length > 0) && (
                  <section className="model-group" role="group" aria-label="On this computer">
                    <div className="model-group-head">
                      <h3>
                        <HardDrive size={15} aria-hidden="true" />
                        On this computer
                      </h3>
                      <span>llama.cpp · {statusLabel[server.phase]}</span>
                    </div>
                    {!config?.modelsDir && (
                      <ModelsFolderActions path="" onConfigured={controller.acceptConfiguration} />
                    )}
                    {!config?.serverAvailable && (
                      <div className="setup-callout">
                        <CircleHelp size={19} />
                        <div>
                          <strong>Set up llama.cpp first</strong>
                          <p>Open Settings to choose a llama.cpp build and a models folder.</p>
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
                          Add a model to your configured folder, or choose another folder in
                          Settings → Folders.
                        </p>
                        <button
                          ref={config.models.length === 0 ? download : undefined}
                          className="text-button"
                          onClick={() => setView('downloads')}
                        >
                          Download models…
                        </button>
                      </div>
                    )}
                    <div className="model-list">
                      {localModels.map((model) => (
                        <button
                          key={model.path}
                          data-in-use={(active && server.model === model.path) || undefined}
                          aria-pressed={selection.kind === 'local' && selected === model.path}
                          className={`model-option ${selection.kind === 'local' && selected === model.path ? 'chosen' : ''}`}
                          disabled={(active && server.model !== model.path) || unavailable}
                          onClick={() => {
                            setSelected(model.path);
                            setCloudSelection(null);
                          }}
                        >
                          <HardDrive size={20} />
                          <span>
                            {fileName(model.path)}
                            <small>
                              {active && server.model === model.path ? 'In use · ' : ''}
                              {model.label}
                            </small>
                            <MemoryBadge
                              bytes={model.sizeBytes}
                              memory={config?.memory}
                              context={controller.draft?.context}
                            />
                            {controller.server.model === model.path &&
                            controller.serverDetails?.visionSupported ? (
                              <small>Vision</small>
                            ) : model.projector ? (
                              <small>Vision · restart to enable</small>
                            ) : null}
                          </span>
                          {selection.kind === 'local' && selected === model.path && (
                            <Check size={17} />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="model-group-actions">
                      {config?.models.length !== 0 && (
                        <button
                          ref={download}
                          className="text-button"
                          onClick={() => setView('downloads')}
                        >
                          Download models…
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={!native || busy}
                        onClick={() => void loadConfiguration()}
                      >
                        <RefreshCw size={14} />
                        Refresh models
                      </button>
                    </div>
                  </section>
                )}
                <CloudModels
                  controller={controller}
                  groups={groups}
                  selection={cloudSelection}
                  onSelect={setCloudSelection}
                  query={needle}
                />
                <p className="model-consequence">
                  <Info size={15} aria-hidden="true" />
                  {selectionConsequence()}
                </p>
                {controller.generating && (
                  <p className="field-help">Available when the response ends.</p>
                )}
                <div className="panel-actions">
                  {selection.kind === 'local' && active ? (
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
                        unavailable ||
                        !!inUse ||
                        (selection.kind === 'local'
                          ? !native || !config?.serverAvailable || !selected
                          : !selectedProvider?.saved)
                      }
                      onClick={() => void useSelectedModel()}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="spin" />
                      ) : selection.kind === 'local' ? (
                        <HardDrive size={15} />
                      ) : (
                        <Cloud size={15} />
                      )}
                      Use model
                    </button>
                  )}
                </div>
              </>
            )}
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
