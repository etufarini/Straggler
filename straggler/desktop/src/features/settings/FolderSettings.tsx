import { settingsForModel } from '../../domain/types';
import type { SettingsController } from './useSettings';
import ModelsFolderActions from '../huggingface/ModelsFolderActions';

export default function FolderSettings({ controller }: { controller: SettingsController }) {
  const { config } = controller;
  return (
    <div id="models-folder" className="folder-setting">
      <h3>Models folder</h3>
      <code>{config.modelsDir || 'Not configured'}</code>
      <ModelsFolderActions
        path={config.modelsDir}
        onConfigured={(value) => {
          controller.accept(value);
          controller.setDraft(settingsForModel(controller.draft, value.settings.model));
        }}
      />
      <p className="field-help">Subfolders are included. The folder can be empty.</p>
    </div>
  );
}
