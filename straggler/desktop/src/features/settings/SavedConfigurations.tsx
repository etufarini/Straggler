import { previewProfile, waitForChatDefaults } from '../../services/desktop';
import { chatDefaultKeys } from '../../domain/chatDefaults';
import type { Settings } from '../../domain/types';
import type { SettingsController } from './useSettings';
import Select from '../../components/Select';

export default function SavedConfigurations({
  controller,
  onDefaultsLoaded,
}: {
  controller: SettingsController;
  onDefaultsLoaded: (settings: Settings) => void;
}) {
  const {
    config,
    draft,
    setDraft,
    accept,
    confirm,
    setSection,
    busy,
    setMessage,
    profile,
    setProfile,
    name,
    setName,
    native,
    run,
    operation,
    saveProfile,
    requestSave,
  } = controller;
  async function requestLoad() {
    await waitForChatDefaults();
    const values = await previewProfile(profile);
    const replacesDefaults = chatDefaultKeys.some((key) => values[key] !== config.settings[key]);
    async function load() {
      const reviewed = await operation('review-profile', [profile]);
      accept(reviewed);
      setDraft(values);
      onDefaultsLoaded(values);
      setSection('model');
      setMessage('Configuration loaded for review. The server was not started.');
    }
    if (replacesDefaults)
      confirm({
        title: 'Load configuration?',
        actionLabel: 'Load configuration',
        text: `Load “${profile}” for review? The server won’t start. Also replaces your chat defaults.`,
        action: load,
      });
    else await load();
  }
  return (
    <>
      <label className="setting-field">
        <span>Configuration</span>
        <Select
          aria-label="Configuration"
          value={profile}
          onChange={setProfile}
          options={[
            { value: '', label: 'Choose a configuration' },
            ...config.profiles.map((value) => ({ value, label: value })),
          ]}
        />
      </label>
      <div className="profile-actions">
        <button disabled={!profile || busy || !native} onClick={() => void run(requestLoad)}>
          Load configuration
        </button>
        <button
          disabled={!profile || busy || !native}
          onClick={() =>
            confirm({
              title: 'Save to selected configuration?',
              actionLabel: 'Replace configuration',
              destructive: true,
              text: `Replace “${profile}” with the current settings?`,
              action: () => saveProfile(profile, true),
            })
          }
        >
          Save to selected
        </button>
        <label className="setting-field">
          <span>New configuration name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name your configuration"
          />
        </label>
        <button disabled={!name.trim() || busy || !native} onClick={requestSave}>
          Save as new configuration
        </button>
        <button
          className="danger-button"
          disabled={!profile || busy || !native}
          onClick={() =>
            confirm({
              title: 'Delete configuration?',
              actionLabel: 'Delete configuration',
              destructive: true,
              text: `Delete “${profile}”? Your current settings and chats won’t change.`,
              action: async () => {
                const value = await operation('delete-profile', [profile, 'confirm']);
                accept(value);
                setDraft(draft);
                setProfile('');
              },
            })
          }
        >
          Delete configuration
        </button>
      </div>
    </>
  );
}
