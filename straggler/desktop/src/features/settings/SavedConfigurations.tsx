import { createPortal } from 'react-dom';
import { ConfirmationFrame } from '../../app/ConfirmationDialog';
import { PresetDialogFocus } from '../prompts/PromptPresets';
import StatusChip from '../../components/StatusChip';
import type { SettingsController } from './useSettings';
import Select from '../../components/Select';

export default function SavedConfigurations({
  controller,
  onClose,
}: {
  controller: SettingsController;
  onClose: () => void;
}) {
  const {
    config,
    draft,
    setDraft,
    accept,
    confirm,
    busy,
    profile,
    setProfile,
    name,
    setName,
    native,
    operation,
    saveProfile,
    requestSave,
  } = controller;
  return createPortal(
    <PresetDialogFocus
      close={() => {
        if (!busy) onClose();
      }}
    >
      <ConfirmationFrame title="Manage configurations" role="dialog" project>
        <p>
          Saves the model, its settings on this computer and your chat defaults. Folders and chats
          aren’t included.
        </p>
        {controller.message && (
          <StatusChip live tone="positive">
            {controller.message}
          </StatusChip>
        )}
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
        <div className="panel-actions">
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Done
          </button>
        </div>
      </ConfirmationFrame>
    </PresetDialogFocus>,
    document.body,
  );
}
