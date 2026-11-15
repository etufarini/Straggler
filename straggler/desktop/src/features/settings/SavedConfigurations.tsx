import type { SettingsController } from './useSettings';
import Select from '../../components/Select';

export default function SavedConfigurations({ controller }: { controller: SettingsController }) {
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
  return (
    <>
      <h2>Saved configurations</h2>
      <p className="field-help">
        Saves model, reply and server settings. Folders and chats aren’t included.
      </p>
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
        <button
          disabled={!profile || busy || !native}
          onClick={() =>
            void run(async () => {
              const value = await operation('load-profile', [profile]);
              accept(value);
              setSection('model');
              setMessage('Configuration loaded for review. The server was not started.');
            })
          }
        >
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
              text: `Delete “${profile}”? Your current settings and conversations stay as they are.`,
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
