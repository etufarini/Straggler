import type { Section } from './sections';
import ChatDefaults from './ChatDefaults';
import useChatDefaults from './useChatDefaults';
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
const sectionGroups: { label: string; sections: [Section, string][] }[] = [
  {
    label: 'All models',
    sections: [
      ['chat-defaults', 'Chat defaults'],
      ['prompts', 'System prompts'],
    ],
  },
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
];

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
  const defaults = useChatDefaults(controller);
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
  const hasApplyAction = ['model', 'performance', 'server'].includes(section);
  usePagePrimaryAction(
    hasApplyAction ? !busy && native : section === 'websearch' ? null : false,
    onPrimaryActionChange,
  );
  const title = sectionGroups
    .flatMap((group) => group.sections)
    .find(([key]) => key === section)?.[1];
  const scope = {
    'chat-defaults':
      'For every model, on this computer and in the cloud. A chat can change its system prompt and reasoning from the message box.',
    prompts:
      'Reusable system prompts for every model. Insert a copy in chat defaults, a project or a chat.',
    model: 'For the model on this computer. Changes apply when the server restarts.',
    performance: 'For the model on this computer. Changes apply when the server restarts.',
    server: 'For the model on this computer. Changes apply when the server restarts.',
    profiles:
      'Saves the model, its settings on this computer and your chat defaults. Folders and chats aren’t included.',
    folders:
      'Folders for models and llama.cpp on this computer. Changes are saved after you accept and validate a folder.',
    llama: 'The llama.cpp backend on this computer. Stop the server before changing its build.',
    huggingface: 'Download models to this computer. Nothing is sent until you search or download.',
    cloud:
      'Optional services for chatting with models hosted elsewhere. Messages leave this computer only when you choose a cloud model and send.',
    websearch:
      'Optional services. Messages go to them only when you choose a cloud model or turn on web search.',
  }[section];
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
            <header className="settings-section-heading">
              <h2>{title}</h2>
              <p className="settings-scope field-help">{scope}</p>
              {section === 'chat-defaults' && (
                <p className="autosave-note">
                  Changes are saved automatically and apply from the next message.
                </p>
              )}
              {section === 'cloud' && (
                <p className="autosave-note">
                  Changes are saved automatically. Chat defaults apply to cloud models too. Values a
                  service doesn’t accept aren’t sent.
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
            </header>
            <div className="settings-section">
              {message && (
                <p role="status" className="success-message">
                  {message}
                </p>
              )}
              {section === 'cloud' && <CloudSettings controller={cloud} />}
              {section === 'prompts' && <SystemPromptsSettings confirm={props.confirm} />}
              {section === 'chat-defaults' && (
                <ChatDefaults controller={controller} cloud={cloud} defaults={defaults} />
              )}
              {section === 'model' && <ModelSettings controller={controller} />}
              {section === 'performance' && <PerformanceSettings controller={controller} />}
              {section === 'server' && <ServerSettings controller={controller} />}
              {section === 'profiles' && (
                <SavedConfigurations controller={controller} onDefaultsLoaded={defaults.reset} />
              )}
              {section === 'folders' && <FolderSettings controller={controller} />}
              {section === 'llama' && <LlamaSettings controller={controller} />}
              {section === 'websearch' && (
                <WebSearchSettings
                  controller={webSearch}
                  onPrimaryActionChange={onPrimaryActionChange}
                />
              )}
              {section === 'huggingface' && <HuggingFaceSettings controller={controller} />}
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
