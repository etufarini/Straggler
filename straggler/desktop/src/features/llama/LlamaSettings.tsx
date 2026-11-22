import type { SettingsController } from '../settings/useSettings';
import ExternalReleaseDate from './ExternalReleaseDate';

export default function LlamaSettings({ controller }: { controller: SettingsController }) {
  const { config, busy, active, native, setFolder, confirm, accept, operation } = controller;
  const bundled = !config.llamaDir && config.serverAvailable;
  return (
    <>
      <p>A version tested with Straggler, updated with the app.</p>
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
            {config.build.tag && (
              <span>
                {config.build.tag} · {config.build.backend}
              </span>
            )}
            {config.build.commit && <code>{config.build.commit}</code>}
          </>
        )}
        {config.llamaDir && <code>{config.llamaDir}</code>}
        <dl className="build-version">
          <div>
            <dt>Version</dt>
            <dd>
              {config.build?.version ?? 'Not reported'}
              {config.build?.buildNumber !== undefined && (
                <small> · b{config.build.buildNumber}</small>
              )}
            </dd>
          </div>
          <div>
            <dt>Release date</dt>
            <dd>
              {bundled ? (
                (config.build?.releaseDate?.split('T')[0] ?? 'Not reported')
              ) : config.serverAvailable && config.llamaDir ? (
                <ExternalReleaseDate
                  key={JSON.stringify([config.llamaDir, config.build])}
                  native={native}
                />
              ) : (
                'Not reported'
              )}
            </dd>
          </div>
        </dl>
      </div>
      {!config.bundledAvailable && (
        <p>
          {config.appStore
            ? 'The bundled backend is missing. Reinstall Straggler from the App Store.'
            : 'This installation has no bundled backend. Select an existing llama.cpp build.'}
        </p>
      )}
      {!config.appStore && (
        <div className="row-actions">
          <button disabled={busy || active || !native} onClick={() => setFolder('llama')}>
            Choose external build…
          </button>
          <button
            disabled={busy || active || !native || !config.bundledAvailable || bundled}
            onClick={() =>
              confirm({
                title: 'Use the bundled version?',
                actionLabel: 'Use bundled version',
                text: 'Model settings and saved configurations are kept.',
                action: async () => {
                  accept(await operation('use-bundled'));
                },
              })
            }
          >
            Use bundled version
          </button>
        </div>
      )}
      <p className="field-help">
        {config.appStore
          ? 'This edition uses the backend included with the app. Updates arrive through the App Store.'
          : 'Stop the server before changing the backend. External builds may support different features.'}
      </p>
    </>
  );
}
