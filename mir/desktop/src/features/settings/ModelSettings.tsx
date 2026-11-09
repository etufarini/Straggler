import type { SettingsController } from './useSettings';
import NumberField from '../../components/NumberField';
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
  max_tokens: 'Maximum output tokens',
};

export default function ModelSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, setDraft, setSection, showSampling, setShowSampling, preset, change } =
    controller;
  return (
    <>
      <h2>Model settings</h2>
      <p className="field-help">
        Context includes input and output. Model support and available memory determine usable
        settings.
      </p>
      <label className="setting-field">
        <span>Model</span>
        <select
          aria-label="Model"
          value={draft.model}
          onChange={(event) => change('model', event.target.value)}
        >
          <option value="">Select a GGUF model</option>
          {draft.model && !config.models.some((model) => model.path === draft.model) && (
            <option value={draft.model}>{fileName(draft.model)}</option>
          )}
          {config.models.map((model) => (
            <option key={model.path} value={model.path}>
              {model.label}
            </option>
          ))}
        </select>
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
      <div className="field-grid">
        <label className="setting-field">
          <span>Context size</span>
          <select
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
            onChange={(event) =>
              change('context', event.target.value === 'custom' ? '2048' : event.target.value)
            }
          >
            <option value="auto">Auto</option>
            <option value="0">Full model context</option>
            {[4096, 8192, 16384, 24576, 32768, 49152, 65536, 131072, 262144].map((size) => (
              <option key={size} value={size}>
                {size / 1024}K
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        <NumberField
          label="Context tokens"
          value={draft.context}
          onChange={(value) => change('context', value)}
          hint="Auto or a custom count. 0 requests the full model context."
        />
      </div>
      <h3>KV Cache</h3>
      <p className="field-help">
        Formats come from the installed server. Quantized V may require Flash Attention; llama.cpp
        reports model and backend restrictions.
      </p>
      <div className="field-grid">
        {(['k', 'v'] as const).map((kind) => {
          const key = `cache_type_${kind}` as 'cache_type_k' | 'cache_type_v';
          const advertised =
            kind === 'k' ? config.capabilities.cacheTypesK : config.capabilities.cacheTypesV;
          const choices = [...new Set([draft[key], ...advertised])];
          return (
            <label key={kind} className="setting-field">
              <span>Cache {kind.toUpperCase()} type</span>
              <select
                aria-label={`Cache ${kind.toUpperCase()} type`}
                value={draft[key]}
                onChange={(event) => change(key, event.target.value)}
              >
                {choices.map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
              {!advertised.length && (
                <small>Supported formats unavailable; the current selection is preserved.</small>
              )}
            </label>
          );
        })}
      </div>
      <h3>Generation</h3>
      <label className="setting-field">
        <span>Sampling preset</span>
        <select
          aria-label="Sampling preset"
          value={preset}
          onChange={(event) => {
            const values = config.presets[event.target.value];
            if (event.target.value === 'custom') setShowSampling(true);
            if (values)
              setDraft({
                ...draft,
                ...Object.fromEntries(samplingKeys.map((key, index) => [key, values[index]])),
              });
          }}
        >
          {[
            ['default', 'Default'],
            ['focused', 'Focused'],
            ['exploratory', 'Exploratory'],
            ['min-p', 'Min-P'],
            ['custom', 'Custom'],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <small>
          Manual starting points. Presets preserve seed, output length, context and performance.
        </small>
      </label>
      <details
        className="sampling-details"
        open={showSampling || preset === 'custom' ? true : undefined}
      >
        <summary>Sampling parameters</summary>
        <div className="field-grid">
          {samplingKeys.map((key) => (
            <NumberField
              key={key}
              label={labels[key]}
              value={draft[key]}
              onChange={(value) => change(key, value)}
            />
          ))}
        </div>
      </details>
      <div className="field-grid">
        <NumberField
          label="Seed"
          value={draft.seed}
          onChange={(value) => change('seed', value)}
          hint="Auto, a numeric seed, or -1 for random. Repeatability across devices is not guaranteed."
        />
        <NumberField
          label="Maximum output tokens"
          value={draft.max_tokens}
          onChange={(value) => change('max_tokens', value)}
          hint="Auto or a count. -1 has no fixed limit; 0 evaluates input only."
        />
      </div>
    </>
  );
}
