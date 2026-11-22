import { useLayoutEffect, useState } from 'react';
import { ArrowLeft, Save, CircleAlert } from 'lucide-react';
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
import FolderBrowser from '../../components/FolderBrowser';
import { useSettings } from './useSettings';
import type { SettingsProps } from './useSettings';
import SavedConfigurations from './SavedConfigurations';
import FolderSettings from './FolderSettings';
import LlamaSettings from '../llama/LlamaSettings';
import HuggingFaceSettings from '../huggingface/HuggingFaceSettings';
import useHubTokenStatus from '../huggingface/useHubTokenStatus';
import Feedback from '../../components/Feedback';
import StatusChip from '../../components/StatusChip';
import Select from '../../components/Select';
import SettingsHeader from './SettingsHeader';
import SettingsOverview from './SettingsOverview';
import UnifiedModelSettings, { focusSettingsTarget } from './UnifiedModelSettings';
import { ChangedSettingsContext } from './ChangedSetting';
import { loadConfiguration } from './configurations';
import { overviewEntry, sectionGroups } from './settingsNavigation';

const scopes: Partial<Record<Section, string>> = {
  overview: 'What Straggler uses now. Select a card to change it.',
  'chat-defaults':
    'For every model, on this computer and in the cloud. A chat can change its system prompt and reasoning from the message box.',
  prompts:
    'Reusable system prompts for every model. Insert a copy in chat defaults, a project or a chat.',
  model: 'For the model on this computer. Changes apply when the server restarts.',
  llama: 'The llama.cpp backend on this computer. Stop the server before changing its build.',
  'model-files':
    'Model files on this computer. Folders are saved after you accept and validate them.',
  cloud:
    'Optional services for chatting with models hosted elsewhere. Messages leave this computer only when you choose a cloud model and send.',
  websearch:
    'Optional web search. Search queries and page addresses go to the service only when you turn on web search.',
};

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
  const tokenStatus = useHubTokenStatus();
  const [manage, setManage] = useState(false);
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
  usePagePrimaryAction(
    section === 'model' ? !busy && native : section === 'websearch' ? null : false,
    onPrimaryActionChange,
  );
  const group = sectionGroups.find((group) => group.sections.some((entry) => entry.id === section));
  const entry = group?.sections.find((entry) => entry.id === section) ?? overviewEntry;
  useLayoutEffect(() => {
    const target = controller.target;
    if (!target) return;
    const frame = requestAnimationFrame(() => focusSettingsTarget(target));
    return () => cancelAnimationFrame(frame);
  }, [section, controller.target]);
  function navEntry(item: typeof overviewEntry) {
    const unavailable =
      item.id === 'model'
        ? !config.models.some((model) => model.path === draft.model)
        : item.id === 'llama' && !config.serverAvailable;
    return (
      <button
        key={item.id}
        className={section === item.id ? 'selected' : ''}
        aria-label={item.label}
        aria-current={section === item.id ? 'page' : undefined}
        onClick={() => {
          setSection(item.id);
          document.querySelector('.settings-page')?.scrollTo({ top: 0 });
        }}
      >
        <item.icon size={16} aria-hidden="true" />
        {item.label}
        {item.id === 'model' && dirty && (
          <span className="settings-dirty-dot" role="img" aria-label="Unapplied changes" />
        )}
        {unavailable && (
          <CircleAlert size={14} role="img" aria-label={`${item.label} unavailable`} />
        )}
      </button>
    );
  }
  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-heading">
            <button className="text-button" onClick={onBack}>
              <ArrowLeft size={16} />
              Back to chat
            </button>
            <h1>Settings</h1>
          </div>
          <nav className="settings-nav" aria-label="Settings sections">
            {navEntry(overviewEntry)}
            {sectionGroups.map((group) => (
              <div
                key={group.label}
                className="settings-nav-group"
                role="group"
                aria-label={group.label}
              >
                <span className="settings-nav-heading">
                  <group.icon size={14} aria-hidden="true" />
                  <span>{group.label}</span>
                </span>
                {group.sections.map(navEntry)}
              </div>
            ))}
          </nav>
        </aside>
        <div className="settings-content" key={section}>
          <fieldset className="settings-fields" disabled={busy || !native}>
            <SettingsHeader
              title={entry.label}
              scope={scopes[section] ?? scopes.overview!}
              group={group}
            >
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
              {['prompts', 'websearch'].includes(section) && (
                <p className="autosave-note">Changes are saved automatically.</p>
              )}
              {section === 'model' && (
                <div className="configuration-heading">
                  <div className="configuration-choice">
                    <Select
                      allowReselect
                      aria-label="Configuration"
                      value={config.currentProfile || ''}
                      options={[
                        { value: '', label: 'Custom settings' },
                        ...config.profiles.map((value) => ({ value, label: value })),
                      ]}
                      onChange={(value) => {
                        if (value)
                          void run(() => loadConfiguration(controller, value, defaults.reset));
                      }}
                    />
                    <span>
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
                  </div>
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
            </SettingsHeader>
            <div className="settings-section">
              {busy && (
                <p role="status" className="field-help">
                  Loading…
                </p>
              )}
              {failure && !manage && !failure.field && failure.section === props.section && (
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
              {message && !manage && (
                <StatusChip live tone="positive">
                  {message}
                </StatusChip>
              )}
              {section === 'overview' && (
                <SettingsOverview
                  controller={controller}
                  cloud={cloud}
                  webSearch={webSearch}
                  tokenStatus={tokenStatus.status}
                />
              )}
              {section === 'cloud' && <CloudSettings controller={cloud} />}
              {section === 'prompts' && <SystemPromptsSettings confirm={props.confirm} />}
              {section === 'chat-defaults' && (
                <ChatDefaults controller={controller} cloud={cloud} defaults={defaults} />
              )}
              {section === 'model' && (
                <ChangedSettingsContext.Provider value={{ draft, saved: config.savedSettings }}>
                  <UnifiedModelSettings controller={controller} onManage={() => setManage(true)} />
                </ChangedSettingsContext.Provider>
              )}
              {section === 'model-files' && (
                <>
                  <FolderSettings controller={controller} />
                  <HuggingFaceSettings tokenStatus={tokenStatus} />
                </>
              )}
              {section === 'llama' && <LlamaSettings controller={controller} />}
              {section === 'websearch' && (
                <WebSearchSettings
                  controller={webSearch}
                  onPrimaryActionChange={onPrimaryActionChange}
                />
              )}
            </div>
          </fieldset>
        </div>
      </div>
      {manage && <SavedConfigurations controller={controller} onClose={() => setManage(false)} />}
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
