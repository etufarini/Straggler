import ChangedSetting from './ChangedSetting';
import SettingsField from '../../components/SettingsField';
import TemplateSettings from './TemplateSettings';
import type { SettingsController } from './useSettings';
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
        <ChangedSetting field="model" />
        <FieldError id="model-error" message={fieldError('model')} />
      </label>
      {!config.models.length && (
        <div className="setup-callout">
          <Folder size={18} />
          <div>
            <strong>No GGUF models found</strong>
            <p>Choose a folder in Model files. Subfolders are included.</p>
            <button onClick={() => setSection('folders')}>Choose models folder</button>
          </div>
        </div>
      )}
      <TemplateSettings controller={controller} />
      <SettingsField
        field="chat_reasoning_effort"
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
    </>
  );
}
