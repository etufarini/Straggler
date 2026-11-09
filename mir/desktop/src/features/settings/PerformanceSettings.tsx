import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import FieldError from '../../components/FieldError';

export default function PerformanceSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change, fieldError } = controller;
  return (
    <>
      <h2>Performance</h2>
      <p className="field-help">Auto uses llama.cpp defaults. Flash Attention remains automatic.</p>
      <label className="setting-field">
        <span>Device</span>
        <select
          value={draft.device}
          aria-invalid={fieldError('device') ? true : undefined}
          aria-describedby={fieldError('device') ? 'device-error' : undefined}
          onChange={(event) => change('device', event.target.value)}
        >
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
        <FieldError id="device-error" message={fieldError('device')} />
      </label>
      <div className="field-grid">
        <NumberField
          label="CPU threads"
          value={draft.threads}
          error={fieldError('threads')}
          onChange={(value) => change('threads', value)}
          hint="Auto or a positive count. More threads are not always faster."
        />
        <NumberField
          label="GPU layers"
          value={draft.gpu_layers}
          error={fieldError('gpu_layers')}
          disabled={draft.device === 'none'}
          onChange={(value) => change('gpu_layers', value)}
          hint={
            draft.device === 'none'
              ? 'Ignored: CPU only always disables GPU layers.'
              : 'Auto, all or a nonnegative count. All may exceed available memory.'
          }
        />
      </div>
      <label className="setting-field">
        <span>Prompt processing</span>
        <select
          value={draft.prompt_processing}
          aria-invalid={fieldError('prompt_processing') ? true : undefined}
          aria-describedby={fieldError('prompt_processing') ? 'prompt-processing-error' : undefined}
          onChange={(event) => change('prompt_processing', event.target.value)}
        >
          <option value="auto">Default</option>
          <option value="low-memory">Low memory</option>
          <option value="large-batch">Large batch</option>
        </select>
        <FieldError id="prompt-processing-error" message={fieldError('prompt_processing')} />
        <small>
          Controls input processing. Large batch uses more memory and does not guarantee faster
          answer generation.
        </small>
      </label>
      {(config.capabilities.multipleDevices ||
        fieldError('tensor_split') ||
        fieldError('fit_target') ||
        fieldError('split_mode')) && (
        <details
          open={
            fieldError('device') ||
            fieldError('tensor_split') ||
            fieldError('fit_target') ||
            fieldError('split_mode')
              ? true
              : undefined
          }
        >
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
              aria-invalid={fieldError('split_mode') ? true : undefined}
              aria-describedby={fieldError('split_mode') ? 'split-mode-error' : undefined}
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
            <FieldError id="split-mode-error" message={fieldError('split_mode')} />
          </label>
          <NumberField
            label="Device proportions"
            value={draft.tensor_split}
            error={fieldError('tensor_split')}
            onChange={(value) => change('tensor_split', value)}
            hint="Relative values in device order, for example 2,1. Leave empty for Auto."
          />
          <NumberField
            label="Fitting margins (MiB)"
            value={draft.fit_target}
            error={fieldError('fit_target')}
            onChange={(value) => change('fit_target', value)}
            hint="Comma-separated nonnegative MiB targets or Auto."
          />
        </details>
      )}
    </>
  );
}
