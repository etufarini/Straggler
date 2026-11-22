import SettingsField from '../../components/SettingsField';
import NumberField from '../../components/NumberField';
import Select from '../../components/Select';
import ChangedSetting from './ChangedSetting';
import type { SettingsController } from './useSettings';

export default function MemorySettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change, fieldError } = controller;
  return (
    <>
      <div className="field-grid related-fields">
        <label className="setting-field">
          <span>Context size</span>
          <Select
            id="context-size"
            aria-label="Context size"
            value={
              [
                'auto',
                '0',
                '4096',
                '8192',
                '16384',
                '24576',
                '32768',
                '49152',
                '65536',
                '131072',
                '262144',
              ].includes(draft.context)
                ? draft.context
                : 'custom'
            }
            onChange={(value) => change('context', value === 'custom' ? '2048' : value)}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '0', label: 'Largest the model supports' },
              ...[4096, 8192, 16384, 24576, 32768, 49152, 65536, 131072, 262144].map((size) => ({
                value: size,
                label: `${size / 1024}K`,
              })),
              { value: 'custom', label: 'Custom' },
            ]}
          />
          <ChangedSetting field="context" />
        </label>
        <NumberField
          field="context"
          label="Custom size (tokens)"
          value={draft.context}
          error={fieldError('context')}
          onChange={(value) => change('context', value)}
          hint="How much of the chat the model remembers. Auto, a token count, or 0 for the maximum."
        />
      </div>
      <div className="settings-note-group">
        <h3>
          Memory format <code className="tech-term">KV cache</code>
        </h3>
        <p className="field-help">
          Smaller formats save memory at a slight cost in quality. Compressed values may need Flash
          Attention.
        </p>
      </div>
      <div className="field-grid related-fields">
        {(['k', 'v'] as const).map((kind) => {
          const key = `cache_type_${kind}` as 'cache_type_k' | 'cache_type_v';
          const advertised =
            kind === 'k' ? config.capabilities.cacheTypesK : config.capabilities.cacheTypesV;
          const choices = [...new Set([draft[key], ...advertised])];
          return (
            <SettingsField
              key={kind}
              field={key}
              label={
                <>
                  {kind === 'k' ? 'Keys format' : 'Values format'}{' '}
                  <code className="tech-term">{kind.toUpperCase()}</code>
                </>
              }
              error={fieldError(key)}
              hint={
                !advertised.length
                  ? 'Couldn’t read the supported formats. Your selection is kept.'
                  : undefined
              }
            >
              {(accessibility) => (
                <Select
                  {...accessibility}
                  aria-label={kind === 'k' ? 'Keys format' : 'Values format'}
                  value={draft[key]}
                  onChange={(value) => change(key, value)}
                  options={choices.map((value) => ({ value, label: value.toUpperCase() }))}
                />
              )}
            </SettingsField>
          );
        })}
      </div>
      <NumberField
        field="gpu_layers"
        label="Model on the GPU"
        term="GPU layers"
        value={draft.gpu_layers}
        error={fieldError('gpu_layers')}
        disabled={draft.device === 'none'}
        onChange={(value) => change('gpu_layers', value)}
        hint={
          draft.device === 'none'
            ? 'Ignored: CPU only always disables GPU layers.'
            : 'Layers on the GPU: Auto, All, or a number. All may not fit in memory.'
        }
      />
      <div className="memory-summary">
        <h3>Memory</h3>
        <span>
          Available RAM:{' '}
          {config.memory.availableRamMiB === null
            ? 'Unavailable'
            : `${(config.memory.availableRamMiB / 1024).toFixed(1)} GiB`}
        </span>
        {config.memory.devices.map((device) => (
          <span key={device.name}>
            {device.name}: {(device.availableMiB / 1024).toFixed(1)} GiB reported free
          </span>
        ))}
        <small>Estimate. llama.cpp confirms it at launch.</small>
      </div>
    </>
  );
}
