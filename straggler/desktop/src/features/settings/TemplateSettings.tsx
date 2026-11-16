import type { SettingsController } from './useSettings';
import Select from '../../components/Select';
import FieldError from '../../components/FieldError';
import { fileName } from '../../domain/types';

export default function TemplateSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change, chooseModelFile, fieldError } = controller;
  const override = config.capabilities.templateOverride;
  const supported = config.capabilities.chatTemplateFile;
  const candidate = config.models.find((model) => model.path === draft.model)?.template;
  const error = fieldError('chat_template_file');
  return (
    <div className="setting-field">
      <label htmlFor="chat-template">Chat template</label>
      <Select
        id="chat-template"
        aria-label="Chat template"
        aria-describedby={error ? 'chat-template-help chat-template-error' : 'chat-template-help'}
        aria-invalid={!!error}
        disabled={!!override}
        value={draft.chat_template_file ? 'custom' : 'default'}
        onChange={(value) => {
          if (value === 'default') change('chat_template_file', '');
          else void chooseModelFile('template');
        }}
        options={[
          { value: 'default', label: 'Default' },
          { value: 'custom', label: 'Custom file…', disabled: !supported },
        ]}
      />
      <small id="chat-template-help">
        {override
          ? `Native environment overrides this setting: ${override}.`
          : supported
            ? 'Default uses the model template. A custom file replaces it after restarting the server.'
            : 'This backend does not advertise custom chat template support.'}
      </small>
      {draft.chat_template_file && (
        <div className="model-file-selection">
          <details>
            <summary>{fileName(draft.chat_template_file)}</summary>
            <code>{draft.chat_template_file}</code>
          </details>
          <button
            disabled={!!override || !supported}
            onClick={() => void chooseModelFile('template')}
          >
            Change template…
          </button>
        </div>
      )}
      {!draft.chat_template_file && candidate && supported && !override && (
        <div className="model-file-selection">
          <small>Template found beside this model: {fileName(candidate)}</small>
          <button onClick={() => change('chat_template_file', candidate)}>Use this file</button>
        </div>
      )}
      <FieldError id="chat-template-error" message={error} />
    </div>
  );
}
