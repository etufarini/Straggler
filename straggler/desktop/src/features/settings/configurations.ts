import { invoke, previewProfile, waitForChatDefaults } from '../../services/desktop';
import { chatDefaultKeys } from '../../domain/chatDefaults';
import type { Configuration, Settings } from '../../domain/types';
import type { SettingsController } from './useSettings';

export async function loadConfiguration(
  controller: SettingsController,
  profile: string,
  onDefaultsLoaded: (settings: Settings) => void,
) {
  await waitForChatDefaults();
  const current = await invoke<Configuration>('configuration');
  const values = await previewProfile(profile);
  const replacesDefaults = chatDefaultKeys.some((key) => values[key] !== current.settings[key]);
  async function load() {
    const reviewed = await controller.operation('review-profile', [profile]);
    controller.accept(reviewed);
    controller.setDraft(values);
    controller.setProfile(profile);
    onDefaultsLoaded(values);
    controller.setSection('model');
    controller.setMessage('Configuration loaded for review. The server was not started.');
  }
  if (replacesDefaults || controller.dirty) {
    controller.confirm({
      title: 'Load configuration?',
      actionLabel: 'Load configuration',
      text: `Load “${profile}” for review? The server won’t start.${controller.dirty ? ' Replaces your unapplied changes.' : ''}${replacesDefaults ? ' Also replaces your chat defaults.' : ''}`,
      action: load,
    });
  } else await load();
}
