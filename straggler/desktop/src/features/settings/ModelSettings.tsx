import SettingsField from '../../components/SettingsField';
import TemplateSettings from './TemplateSettings';
import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import FieldError from '../../components/FieldError';
import Select from '../../components/Select';
import { Folder } from 'lucide-react';
import { fileName } from '../../domain/types';
export default function ModelSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, setSection, change, fieldError } = controller;
  const efforts =
    controller.server.model === draft.model ? (controller.serverDetails?.effortLevels ?? []) : [];
  const effortOptions = [
    { value: 'auto', label: 'Template default' },
    ...(draft.chat_reasoning_effort !== 'auto' && !efforts.includes(draft.chat_reasoning_effort)
      ? [
          {
            value: draft.chat_reasoning_effort,
            label: `${draft.chat_reasoning_effort} (not listed by the model)`,
            disabled: true,
          },
        ]
      : []),
    ...efforts.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
  ];
  return (
    <>
      <label className="setting-field">
        <span>Model</span>
        <Select
          aria-label="Model"
          aria-invalid={fieldError('model') ? true : undefined}
          aria-describedby={fieldError('model') ? 'model-error' : undefined}
          value={draft.model}
          onChange={(value) => change('model', value)}
          options={[
            { value: '', label: 'Choose a model' },
            ...(draft.model && !config.models.some((model) => model.path === draft.model)
              ? [{ value: draft.model, label: fileName(draft.model) }]
              : []),
            ...config.models.map((model) => ({ value: model.path, label: model.label })),
          ]}
        />
        <FieldError id="model-error" message={fieldError('model')} />
      </label>
      {!config.models.length && (
        <div className="setup-callout">
          <Folder size={18} />
          <div>
            <strong>No GGUF models found</strong>
            <p>Choose a models folder in Folders. Subfolders are included.</p>
            <button onClick={() => setSection('folders')}>Choose models folder</button>
          </div>
        </div>
      )}
      <TemplateSettings controller={controller} />
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
        </label>
        <NumberField
          label="Custom size (tokens)"
          value={draft.context}
          error={fieldError('context')}
          onChange={(value) => change('context', value)}
          hint="How much of the chat the model remembers. Auto, a token count, or 0 for the maximum."
        />
      </div>
      <h3>
        Memory format <code className="tech-term">KV cache</code>
      </h3>
      <p className="field-help">
        Smaller formats save memory at a slight cost in quality. Compressed values may need Flash
        Attention.
      </p>
      <div className="field-grid related-fields">
        {(['k', 'v'] as const).map((kind) => {
          const key = `cache_type_${kind}` as 'cache_type_k' | 'cache_type_v';
          const advertised =
            kind === 'k' ? config.capabilities.cacheTypesK : config.capabilities.cacheTypesV;
          const choices = [...new Set([draft[key], ...advertised])];
          return (
            <SettingsField
              key={kind}
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
      <SettingsField
        label="Default effort for this model"
        hint="Levels come from the model’s chat template. A chat can change it from the message box."
        error={fieldError('chat_reasoning_effort')}
      >
        {(accessibility) => (
          <Select
            {...accessibility}
            aria-label="Default effort for this model"
            disabled={!efforts.length}
            value={draft.chat_reasoning_effort}
            onChange={(value) => change('chat_reasoning_effort', value)}
            options={effortOptions}
          />
        )}
      </SettingsField>
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
