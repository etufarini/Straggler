import type { SettingsController } from './useSettings';
import { Folder } from 'lucide-react';

export default function FolderSettings({ controller }: { controller: SettingsController }) {
  const { config, setSection, busy, setFolder, native, active, building } = controller;
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
          <code>{path || 'Not configured'}</code>
          <button
            disabled={busy || !native || (kind === 'llama' && (active || building))}
            onClick={() => setFolder(kind as 'llama' | 'models')}
          >
            <Folder size={15} />
            Choose folder
          </button>
        </div>
      ))}
      <p className="field-help">
        The models folder can be empty. The llama.cpp folder must contain llama-server, in bin or
        build/bin.
      </p>
      <button onClick={() => setSection('llama')}>Install / update llama.cpp</button>
    </>
  );
}
