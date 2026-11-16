import TemplateSettings from './TemplateSettings';
import ChatDefaults from './ChatDefaults';
import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
import FieldError from '../../components/FieldError';
import Select from '../../components/Select';
import { Folder } from 'lucide-react';
import { fileName, samplingKeys } from '../../domain/types';
const labels: Record<string, string> = {
  temperature: 'Temperature',
  top_p: 'Top-P',
  top_k: 'Top-K',
  min_p: 'Min-P',
  repeat_penalty: 'Repeat penalty',
  presence_penalty: 'Presence penalty',
  frequency_penalty: 'Frequency penalty',
  seed: 'Seed',
  max_tokens: 'Longest reply (tokens)',
};

const samplingHints = {
  temperature: 'Higher is more varied, lower more predictable.',
  top_p: 'Keeps the most likely words that add up to this share.',
  top_k: 'Keeps only this many of the most likely words.',
  min_p: 'Drops words far less likely than the best one.',
  repeat_penalty: 'Discourages repeating recent words.',
  presence_penalty: 'Encourages words not used yet.',
  frequency_penalty: 'Discourages words that appear often.',
};

export default function ModelSettings({ controller }: { controller: SettingsController }) {
  const {
    config,
    draft,
    setDraft,
    setSection,
    showSampling,
    setShowSampling,
    preset,
    change,
    fieldError,
  } = controller;
  return (
    <>
      <h2>Model settings</h2>
      <p className="field-help">Options depend on the model and available memory.</p>
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
            <p>Choose your models folder in Folders. Models can be organized in subfolders.</p>
            <button onClick={() => setSection('folders')}>Choose models folder</button>
          </div>
        </div>
      )}
      <TemplateSettings controller={controller} />
      <div className="field-grid">
        <label className="setting-field">
          <span>Context size</span>
          <Select
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
      <div className="field-grid">
        {(['k', 'v'] as const).map((kind) => {
          const key = `cache_type_${kind}` as 'cache_type_k' | 'cache_type_v';
          const advertised =
            kind === 'k' ? config.capabilities.cacheTypesK : config.capabilities.cacheTypesV;
          const choices = [...new Set([draft[key], ...advertised])];
          return (
            <label key={kind} className="setting-field">
              <span>
                {kind === 'k' ? 'Keys format' : 'Values format'}{' '}
                <code className="tech-term">{kind.toUpperCase()}</code>
              </span>
              <Select
                aria-label={kind === 'k' ? 'Keys format' : 'Values format'}
                aria-invalid={fieldError(key) ? true : undefined}
                aria-describedby={fieldError(key) ? `${key}-error` : undefined}
                value={draft[key]}
                onChange={(value) => change(key, value)}
                options={choices.map((value) => ({ value, label: value.toUpperCase() }))}
              />
              <FieldError id={`${key}-error`} message={fieldError(key)} />
              {!advertised.length && (
                <small>Supported formats unavailable; the current selection is preserved.</small>
              )}
            </label>
          );
        })}
      </div>
      <h3>Replies</h3>
      <label className="setting-field">
        <span>
          Reply style <code className="tech-term">Sampling preset</code>
        </span>
        <Select
          aria-label="Reply style"
          value={preset}
          onChange={(value) => {
            const values = config.presets[value];
            if (value === 'custom') setShowSampling(true);
            if (values)
              setDraft({
                ...draft,
                ...Object.fromEntries(samplingKeys.map((key, index) => [key, values[index]])),
              });
          }}
          options={[
            ['default', 'Default'],
            ['focused', 'Focused'],
            ['exploratory', 'Exploratory'],
            ['min-p', 'Min-P'],
            ['custom', 'Custom'],
          ].map(([value, label]) => ({ value, label }))}
        />
        <small>
          Presets for the values below. Seed, reply length, context and performance don’t change.
        </small>
      </label>
      <details
        className="sampling-details"
        open={
          showSampling || preset === 'custom' || samplingKeys.some((key) => fieldError(key))
            ? true
            : undefined
        }
      >
        <summary>Fine-tune reply style</summary>
        <p className="field-help">Leave a field empty to use the llama.cpp default.</p>
        <div className="field-grid">
          {samplingKeys.map((key) => (
            <NumberField
              key={key}
              label={labels[key]}
              hint={samplingHints[key]}
              value={draft[key]}
              error={fieldError(key)}
              onChange={(value) => change(key, value)}
            />
          ))}
        </div>
      </details>
      <div className="field-grid">
        <NumberField
          label="Seed"
          value={draft.seed}
          error={fieldError('seed')}
          onChange={(value) => change('seed', value)}
          hint="The same seed repeats a result on this computer; -1 is random."
        />
        <NumberField
          label="Longest reply (tokens)"
          value={draft.max_tokens}
          error={fieldError('max_tokens')}
          onChange={(value) => change('max_tokens', value)}
          hint="Auto, a number, or -1 for no limit."
        />
      </div>
      <ChatDefaults controller={controller} />
    </>
  );
}
