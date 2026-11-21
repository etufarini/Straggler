import CloudSettings from '../cloud/CloudSettings';
import type { CloudController } from '../cloud/useCloudModels';
import SystemPromptsSettings from '../prompts/SystemPromptsSettings';
import { settingsForModel } from '../../domain/types';
import usePagePrimaryAction from '../../app/usePagePrimaryAction';
import WebSearchSettings from '../websearch/WebSearchSettings';
import type { WebSearchController } from '../websearch/useWebSearch';
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
const sectionGroups = [
  { label: 'All models', sections: [['prompts', 'System prompts']] },
  {
    label: 'On this computer',
    sections: [
      ['model', 'Model settings'],
      ['performance', 'Performance'],
      ['server', 'Server & port'],
      ['profiles', 'Saved configurations'],
      ['folders', 'Folders'],
      ['llama', 'llama.cpp'],
      ['huggingface', 'Hugging Face'],
    ],
  },
  {
    label: 'Cloud and web',
    sections: [
      ['cloud', 'Cloud models'],
      ['websearch', 'Web search'],
    ],
  },
] as const;

export default function Settings({
  webSearch,
  cloud,
  onPrimaryActionChange,
  ...props
}: SettingsProps & {
  webSearch: WebSearchController;
  cloud: CloudController;
  onPrimaryActionChange: (active: boolean) => void;
}) {
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
  const hasApplyAction = ['model', 'performance', 'server', 'profiles'].includes(section);
  usePagePrimaryAction(
    hasApplyAction ? !busy && native : section === 'websearch' ? null : false,
    onPrimaryActionChange,
  );
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-heading">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to chat
        </button>
        <h1>Settings</h1>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sectionGroups.map((group) => (
            <div
              key={group.label}
              className="settings-nav-group"
              role="group"
              aria-label={group.label}
            >
              <span className="settings-nav-heading">{group.label}</span>
              {group.sections.map(([key, label]) => (
                <button
                  key={key}
                  className={section === key ? 'selected' : ''}
                  aria-current={section === key ? 'page' : undefined}
                  onClick={() => setSection(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          {failure && !failure.field && failure.section === section && (
            <Feedback
              title={
                section === 'llama'
                  ? 'Couldn’t complete the llama.cpp action'
                  : 'Couldn’t update settings'
              }
              details={failure.message}
            >
              Check the details and try again. Your edits are kept.
            </Feedback>
          )}
          <fieldset className="settings-fields" disabled={busy || !native}>
            {busy && (
              <p role="status" className="field-help">
                Loading…
              </p>
            )}
            {hasApplyAction && (
              <div className="configuration-heading">
                <span>
                  {config.currentProfile || 'Custom settings'}
                  {modified && (
                    <b
                      role="note"
                      title="Differs from the saved configuration. Save it to keep these values."
                      aria-label="Modified. Differs from the saved configuration. Save it to keep these values."
                    >
                      Modified
                    </b>
                  )}
                  {dirty && (
                    <b
                      role="note"
                      title="Select Apply changes to use these values."
                      aria-label="Unapplied changes. Select Apply changes to use these values."
                    >
                      Unapplied changes
                    </b>
                  )}
                  {active && restart && (
                    <b
                      role="note"
                      title="Stop and launch the server to use the new values."
                      aria-label="Restart required. Stop and launch the server to use the new values."
                    >
                      Restart required
                    </b>
                  )}
                </span>
                <button
                  className="primary-button"
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
              {section === 'cloud' && <CloudSettings controller={cloud} />}
              {section === 'prompts' && <SystemPromptsSettings confirm={props.confirm} />}
              {section === 'model' && <ModelSettings controller={controller} />}
              {section === 'performance' && <PerformanceSettings controller={controller} />}
              {section === 'server' && <ServerSettings controller={controller} />}
              {section === 'profiles' && <SavedConfigurations controller={controller} />}
              {section === 'folders' && <FolderSettings controller={controller} />}
              {section === 'llama' && <LlamaSettings controller={controller} />}
              {section === 'websearch' && (
                <WebSearchSettings
                  controller={webSearch}
                  onPrimaryActionChange={onPrimaryActionChange}
                />
              )}
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
                <small>Estimate. llama.cpp confirms it at launch.</small>
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
            setDraft(settingsForModel(draft, value.settings.model));
          }}
        />
      )}
    </section>
  );
}
