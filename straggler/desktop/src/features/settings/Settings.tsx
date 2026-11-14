import { ArrowLeft, Save } from 'lucide-react';
import FolderBrowser from '../../components/FolderBrowser';
import { useSettings } from './useSettings';
import type { SettingsProps } from './useSettings';
import ModelSettings from './ModelSettings';
import PerformanceSettings from './PerformanceSettings';
import ServerSettings from './ServerSettings';
import SavedConfigurations from './SavedConfigurations';
import FolderSettings from './FolderSettings';
import LlamaSettings from '../llama/LlamaSettings';
import HuggingFaceSettings from '../huggingface/HuggingFaceSettings';
import Feedback from '../../components/Feedback';
const sections = [
  ['model', 'Model settings'],
  ['performance', 'Performance'],
  ['server', 'Server & port'],
  ['profiles', 'Saved configurations'],
  ['folders', 'Folders'],
  ['huggingface', 'Hugging Face'],
  ['llama', 'llama.cpp'],
] as const;

export default function Settings(props: SettingsProps) {
  const controller = useSettings(props);
  const {
    config,
    draft,
    setDraft,
    accept,
    onBack,
    section,
    setSection,
    busy,
    message,
    setMessage,
    folder,
    setFolder,
    native,
    active,
    dirty,
    modified,
    restart,
    apply,
    run,
    operation,
    failure,
  } = controller;
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-heading">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to chat
        </button>
        <h1>Settings</h1>
        <p>Choose how the model runs on this computer.</p>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(([key, label]) => (
            <button
              key={key}
              className={section === key ? 'selected' : ''}
              aria-current={section === key ? 'page' : undefined}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {failure && !failure.field && failure.section === section && (
            <Feedback
              title={
                section === 'llama' ? 'llama.cpp operation failed' : 'Settings could not be updated'
              }
              details={failure.message}
            >
              Review the details and try again. Your edited settings remain available.
            </Feedback>
          )}
          <fieldset className="settings-fields" disabled={busy || !native}>
            {busy && (
              <p role="status" className="field-help">
                Loading…
              </p>
            )}
            {section !== 'folders' && section !== 'llama' && section !== 'huggingface' && (
              <div className="configuration-heading">
                <span>
                  {config.currentProfile || 'Unsaved configuration'}
                  {modified && <b>Modified</b>}
                  {dirty && <b>Unapplied changes</b>}
                  {active && restart && <b>Restart required</b>}
                </span>
                <button
                  disabled={busy || !native}
                  onClick={() =>
                    void run(async () => {
                      await apply();
                      setMessage('Settings applied.');
                    })
                  }
                >
                  <Save size={14} />
                  Apply changes
                </button>
              </div>
            )}
            <div className="settings-section">
              {message && (
                <p role="status" className="success-message">
                  {message}
                </p>
              )}
              {section === 'model' && <ModelSettings controller={controller} />}
              {section === 'performance' && <PerformanceSettings controller={controller} />}
              {section === 'server' && <ServerSettings controller={controller} />}
              {section === 'profiles' && <SavedConfigurations controller={controller} />}
              {section === 'folders' && <FolderSettings controller={controller} />}
              {section === 'llama' && <LlamaSettings controller={controller} />}
              {section === 'huggingface' && <HuggingFaceSettings controller={controller} />}
              <div className="memory-summary">
                <h3>Memory</h3>
                <span>
                  Available RAM:{' '}
                  {config.memory.availableRamMiB === null
                    ? 'Unavailable'
                    : `${(config.memory.availableRamMiB / 1024).toFixed(1)} GiB`}
                </span>
                {config.memory.devices.map((device) => (
                  <span key={device.name}>
                    {device.name}: {(device.availableMiB / 1024).toFixed(1)} GiB reported free
                  </span>
                ))}
                <small>An estimate. llama.cpp makes the final check when the server starts.</small>
              </div>
            </div>
          </fieldset>
        </div>
      </div>
      {folder && (
        <FolderBrowser
          initial={folder === 'llama' ? config.llamaDir : config.modelsDir}
          onClose={() => setFolder(null)}
          onSelect={async (path) => {
            const value = await operation('set-path', [folder, path]);
            accept(value);
            setDraft({ ...draft, model: value.settings.model });
          }}
        />
      )}
    </section>
  );
}
