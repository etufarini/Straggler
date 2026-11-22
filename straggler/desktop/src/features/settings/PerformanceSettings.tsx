import ChangedSetting from './ChangedSetting';
import MtpSettings from './MtpSettings';
import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import FieldError from '../../components/FieldError';
import Select from '../../components/Select';

export default function PerformanceSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change, fieldError } = controller;
  return (
    <>
      <p className="field-help">Auto lets llama.cpp choose for your hardware.</p>
      <label className="setting-field">
        <span>Device</span>
        <Select
          aria-label="Device"
          value={draft.device}
          aria-invalid={fieldError('device') ? true : undefined}
          aria-describedby={fieldError('device') ? 'device-error' : undefined}
          onChange={(value) => change('device', value)}
          options={[
            { value: 'auto', label: 'Auto (llama.cpp chooses)' },
            { value: 'none', label: 'CPU only' },
            ...(!['auto', 'none', ...config.devices.map((device) => device.name)].includes(
              draft.device,
            )
              ? [{ value: draft.device, label: draft.device }]
              : []),
            ...config.devices.map((device) => ({
              value: device.name,
              label: `${device.name}: ${device.label}`,
            })),
          ]}
        />
        <ChangedSetting field="device" />
        <FieldError id="device-error" message={fieldError('device')} />
      </label>

      <NumberField
        field="threads"
        label="CPU threads"
        value={draft.threads}
        error={fieldError('threads')}
        onChange={(value) => change('threads', value)}
        hint="Auto or a number. More is not always faster."
      />

      <label className="setting-field">
        <span>
          Reading your message <code className="tech-term">Prompt processing</code>
        </span>
        <Select
          aria-label="Reading your message"
          value={draft.prompt_processing}
          aria-invalid={fieldError('prompt_processing') ? true : undefined}
          aria-describedby={`prompt-processing-help${fieldError('prompt_processing') ? ' prompt-processing-error' : ''}`}
          onChange={(value) => change('prompt_processing', value)}
          options={[
            { value: 'auto', label: 'Default' },
            { value: 'low-memory', label: 'Low memory' },
            { value: 'large-batch', label: 'Large batch' },
          ]}
        />
        <small id="prompt-processing-help">
          Larger values read long messages faster but use more memory. Replies aren’t faster.
        </small>
        <ChangedSetting field="prompt_processing" />
        <FieldError id="prompt-processing-error" message={fieldError('prompt_processing')} />
      </label>
      <MtpSettings controller={controller} />
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
          <summary>Advanced: several devices · 4 settings</summary>
          <p className="field-help">
            Values follow the device order. Margins are targets, not guarantees.
          </p>
          <label className="setting-field">
            <span>Device names</span>
            <input
              aria-label="Device names"
              aria-describedby={`device-names-help${fieldError('device') ? ' device-names-error' : ''}`}
              aria-invalid={fieldError('device') ? true : undefined}
              value={draft.device}
              onChange={(event) => change('device', event.target.value)}
            />
            <small id="device-names-help">Auto, none, or device names separated by commas.</small>
            <ChangedSetting field="device" />
            <FieldError id="device-names-error" message={fieldError('device')} />
          </label>
          <label className="setting-field">
            <span>
              How to split the model <code className="tech-term">Split mode</code>
            </span>
            <Select
              aria-label="How to split the model"
              value={draft.split_mode}
              aria-invalid={fieldError('split_mode') ? true : undefined}
              aria-describedby={fieldError('split_mode') ? 'split-mode-error' : undefined}
              onChange={(value) => change('split_mode', value)}
              options={[
                ...new Set(['auto', draft.split_mode, ...config.capabilities.splitModes]),
              ].map((mode) => ({
                value: mode,
                label: mode === 'tensor' ? 'tensor (experimental)' : mode,
              }))}
            />
            <ChangedSetting field="split_mode" />
            <FieldError id="split-mode-error" message={fieldError('split_mode')} />
          </label>
          <NumberField
            field="tensor_split"
            label="Device proportions"
            value={draft.tensor_split}
            error={fieldError('tensor_split')}
            onChange={(value) => change('tensor_split', value)}
            hint="Share of the model per device, for example 2,1. Empty is Auto."
          />
          <NumberField
            field="fit_target"
            label="Memory margins (MiB)"
            term="Fitting margins"
            value={draft.fit_target}
            error={fieldError('fit_target')}
            onChange={(value) => change('fit_target', value)}
            hint="A target per device, separated by commas, or Auto."
          />
        </details>
      )}
    </>
  );
}
