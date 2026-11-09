import type { SettingsController } from './useSettings';

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
        Profiles save model, generation and server settings. Folders and conversations stay
        separate.
      </p>
      <label className="setting-field">
        <span>Configuration</span>
        <select value={profile} onChange={(event) => setProfile(event.target.value)}>
          <option value="">Choose a configuration</option>
          {config.profiles.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
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
          disabled={!config.currentProfile || busy || !native}
          onClick={() =>
            confirm({
              title: 'Update current configuration?',
              text: `Replace “${config.currentProfile}” with the current settings?`,
              action: () => saveProfile(config.currentProfile!, true),
            })
          }
        >
          Update current
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
              text: `Delete “${profile}”? Current model settings and conversations will be kept.`,
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
