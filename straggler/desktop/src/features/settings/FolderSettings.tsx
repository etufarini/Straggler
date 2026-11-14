import type { SettingsController } from './useSettings';
import { Folder } from 'lucide-react';
import ModelsFolderActions from '../huggingface/ModelsFolderActions';

export default function FolderSettings({ controller }: { controller: SettingsController }) {
  const { config, setSection, busy, setFolder, native, active } = controller;
  return (
    <>
      <h2>Folders</h2>
      <p className="autosave-note">Saved automatically once a folder is validated.</p>
      {[
        ['llama', 'llama.cpp folder', config.llamaDir],
        ['models', 'Models folder', config.modelsDir],
      ].map(([kind, label, path]) => (
        <div className="folder-setting" key={kind}>
          <h3>{label}</h3>
          <code>
            {path ||
              (kind === 'llama' && config.bundledAvailable
                ? 'Bundled with Straggler'
                : 'Not configured')}
          </code>
          {kind === 'models' ? (
            <ModelsFolderActions
              path={path}
              onConfigured={(value) => {
                controller.accept(value);
                controller.setDraft({ ...controller.draft, model: value.settings.model });
              }}
            />
          ) : (
            !config.appStore && (
              <button
                disabled={busy || !native || (kind === 'llama' && active)}
                onClick={() => setFolder(kind as 'llama' | 'models')}
              >
                <Folder size={15} />
                Choose folder
              </button>
            )
          )}
        </div>
      ))}
      <p className="field-help">
        {config.appStore
          ? 'Choose a models folder to allow access after restarting the app. The folder can be empty.'
          : 'The models folder can be empty. The llama.cpp folder must contain llama-server, in bin or build/bin.'}
      </p>
      <button onClick={() => setSection('llama')}>Backend details</button>
    </>
  );
}
