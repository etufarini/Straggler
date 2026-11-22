import StatusChip from '../../components/StatusChip';
import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import { RefreshCw } from 'lucide-react';

export default function ServerSettings({ controller }: { controller: SettingsController }) {
  const {
    config,
    draft,
    busy,
    forceTargets,
    native,
    active,
    change,
    apply,
    run,
    stopListeners,
    fieldError,
  } = controller;
  const occupied = config.portStatus.includes('IN USE');
  const processDetails =
    config.portStatus.split('\n').slice(1).join('\n') ||
    config.listeners.map((listener) => listener.details).join('\n');
  return (
    <>
      <NumberField
        field="port"
        label="Port"
        term="TCP"
        value={draft.port}
        error={fieldError('port')}
        onChange={(value) => change('port', value)}
        hint="1–65535. Only this computer (127.0.0.1) can connect."
      />
      <div className="row-actions port-status-row">
        <StatusChip live tone={config.portStatus.includes('IN USE') ? 'attention' : 'positive'}>
          {config.portStatus
            .split('\n')[0]
            .replace(/Port (\d+): FREE/, 'Port $1 is free')
            .replace(/Port (\d+): IN USE/, 'Port $1 is in use')}
        </StatusChip>
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
          Check again
        </button>
      </div>
      {occupied && (
        <>
          {processDetails && <pre className="process-details">{processDetails}</pre>}
          <div className="settings-note-group">
            <div className="row-actions">
              <button
                disabled={
                  busy || active || draft.port !== config.settings.port || !config.listeners.length
                }
                onClick={() => stopListeners(false)}
              >
                Close programs using it
              </button>
              <button
                className="danger-button"
                disabled={
                  busy || active || draft.port !== config.settings.port || !forceTargets.length
                }
                onClick={() => stopListeners(true)}
              >
                Force quit
              </button>
            </div>
            <p className="field-help">
              Straggler asks before stopping or force-quitting anything. Unidentified programs still
              block the launch.
            </p>{' '}
          </div>
        </>
      )}
    </>
  );
}
