import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';

export default function PerformanceSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change } = controller;
  return (
    <>
      <h2>Performance</h2>
      <p className="field-help">Auto uses llama.cpp defaults. Flash Attention remains automatic.</p>
      <label className="setting-field">
        <span>Device</span>
        <select value={draft.device} onChange={(event) => change('device', event.target.value)}>
          <option value="auto">Auto: let llama.cpp choose</option>
          <option value="none">CPU only</option>
          {!['auto', 'none', ...config.devices.map((device) => device.name)].includes(
            draft.device,
          ) && <option value={draft.device}>{draft.device}</option>}
          {config.devices.map((device) => (
            <option key={device.name} value={device.name}>
              {device.name}: {device.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-grid">
        <NumberField
          label="CPU threads"
          value={draft.threads}
          onChange={(value) => change('threads', value)}
          hint="Auto or a positive count. More threads are not always faster."
        />
        <label className="setting-field">
          <span>GPU layers</span>
          <input
            aria-label="GPU layers"
            disabled={draft.device === 'none'}
            placeholder="Auto"
            value={draft.gpu_layers === 'auto' ? '' : draft.gpu_layers}
            onChange={(event) => change('gpu_layers', event.target.value || 'auto')}
          />
          <small>
            {draft.device === 'none'
              ? 'Ignored: CPU only always disables GPU layers.'
              : 'Auto, all or a nonnegative count. All may exceed available memory.'}
          </small>
        </label>
      </div>
      <label className="setting-field">
        <span>Prompt processing</span>
        <select
          value={draft.prompt_processing}
          onChange={(event) => change('prompt_processing', event.target.value)}
        >
          <option value="auto">Default</option>
          <option value="low-memory">Low memory</option>
          <option value="large-batch">Large batch</option>
        </select>
        <small>
          Controls input processing. Large batch uses more memory and does not guarantee faster
          answer generation.
        </small>
      </label>
      {config.capabilities.multipleDevices && (
        <details>
          <summary>Advanced device settings</summary>
          <p className="field-help">
            Device names and proportions follow the selected device order. Memory margins are
            fitting targets in MiB, not allocation guarantees.
          </p>
          <label className="setting-field">
            <span>Device names</span>
            <input
              aria-label="Device names"
              value={draft.device}
              onChange={(event) => change('device', event.target.value)}
            />
            <small>Auto, none, or comma-separated names from the installed server.</small>
          </label>
          <label className="setting-field">
            <span>Split mode</span>
            <select
              value={draft.split_mode}
              onChange={(event) => change('split_mode', event.target.value)}
            >
              {[...new Set(['auto', draft.split_mode, ...config.capabilities.splitModes])].map(
                (mode) => (
                  <option key={mode} value={mode}>
                    {mode === 'tensor' ? 'tensor (experimental)' : mode}
                  </option>
                ),
              )}
            </select>
          </label>
          <NumberField
            label="Device proportions"
            value={draft.tensor_split}
            onChange={(value) => change('tensor_split', value)}
            hint="Relative values in device order, for example 2,1. Leave empty for Auto."
          />
          <NumberField
            label="Fitting margins (MiB)"
            value={draft.fit_target}
            onChange={(value) => change('fit_target', value)}
            hint="Comma-separated nonnegative MiB targets or Auto."
          />
        </details>
      )}
    </>
  );
}
