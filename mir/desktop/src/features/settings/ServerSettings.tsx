import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import { RefreshCw } from 'lucide-react';

export default function ServerSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, busy, forceTargets, native, active, change, apply, run, stopListeners } =
    controller;
  return (
    <>
      <h2>Server & port</h2>
      <NumberField
        label="TCP port"
        value={draft.port}
        onChange={(value) => change('port', value)}
        hint="A port from 1 to 65535. The desktop server listens on 127.0.0.1."
      />
      <button
        className="text-button"
        disabled={busy || !native}
        onClick={() =>
          void run(async () => {
            await apply();
          })
        }
      >
        <RefreshCw size={14} />
        Refresh port status
      </button>
      <pre className="process-details">{config.portStatus}</pre>
      <div className="row-actions">
        <button
          disabled={
            busy || active || draft.port !== config.settings.port || !config.listeners.length
          }
          onClick={() => stopListeners(false)}
        >
          Stop process using port
        </button>
        <button
          className="danger-button"
          disabled={busy || active || draft.port !== config.settings.port || !forceTargets.length}
          onClick={() => stopListeners(true)}
        >
          Force stop process…
        </button>
      </div>
      <p className="field-help">
        Processes are rechecked before signaling. SIGTERM requests normal shutdown; SIGKILL requires
        a separate confirmation. Unidentified listeners still block launch.
      </p>
    </>
  );
}
