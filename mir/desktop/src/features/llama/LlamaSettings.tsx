import type { SettingsController } from '../settings/useSettings';

export default function LlamaSettings({ controller }: { controller: SettingsController }) {
  const { config, busy, active, native, setFolder, confirm, accept, operation } = controller;
  const bundled = !config.llamaDir && config.serverAvailable;
  return (
    <>
      <h2>llama.cpp</h2>
      <p>
        The bundled backend is pinned to a version tested with Mir.cpp. Backend updates are
        delivered with application updates.
      </p>
      <div className="build-summary">
        <strong>
          {config.serverAvailable
            ? bundled
              ? 'Bundled backend'
              : 'External build'
            : 'Backend unavailable'}
        </strong>
        {config.build && (
          <>
            <span>
              {config.build.tag} · {config.build.backend}
            </span>
            <code>{config.build.commit}</code>
          </>
        )}
        {config.llamaDir && <code>{config.llamaDir}</code>}
      </div>
      {!config.bundledAvailable && (
        <p>This installation has no bundled backend. Select an existing llama.cpp build.</p>
      )}
      <div className="row-actions">
        <button disabled={busy || active || !native} onClick={() => setFolder('llama')}>
          Choose external build
        </button>
        <button
          disabled={busy || active || !native || !config.bundledAvailable || bundled}
          onClick={() =>
            confirm({
              title: 'Use the bundled backend?',
              actionLabel: 'Use bundled backend',
              text: 'Switch to the llama.cpp version included with Mir.cpp? Model settings and saved configurations will be kept.',
              action: async () => {
                accept(await operation('use-bundled'));
              },
            })
          }
        >
          Use bundled backend
        </button>
      </div>
      <p className="field-help">
        External builds can advertise different capabilities. Stop the server before changing its
        backend.
      </p>
    </>
  );
}
