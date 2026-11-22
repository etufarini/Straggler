import ChangedSetting from './ChangedSetting';
import type { SettingsController } from './useSettings';
import Select from '../../components/Select';
import FieldError from '../../components/FieldError';
import { fileName } from '../../domain/types';

export default function MtpSettings({ controller }: { controller: SettingsController }) {
  const { config, draft, change, chooseModelFile, fieldError } = controller;
  const override = config.capabilities.mtpOverride;
  const supported = config.capabilities.mtp;
  const externalSupported = supported && config.capabilities.mtpFile;
  const error = fieldError('mtp') || fieldError('mtp_file');
  return (
    <div id="setting-mtp" className="setting-field">
      <label htmlFor="mtp">Multi-token prediction (MTP)</label>
      <Select
        id="mtp"
        aria-label="Multi-token prediction (MTP)"
        aria-describedby={error ? 'mtp-help mtp-error' : 'mtp-help'}
        aria-invalid={!!error}
        disabled={!!override}
        value={draft.mtp}
        onChange={(value) => {
          if (value === 'file') void chooseModelFile('mtp');
          else change('mtp', value);
        }}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'model', label: "Use model's MTP", disabled: !supported },
          { value: 'file', label: 'Use external MTP file…', disabled: !externalSupported },
        ]}
      />
      <small id="mtp-help">
        {override
          ? `Native environment overrides this setting: ${override}.`
          : supported
            ? 'May speed up replies with a compatible model. Changes take effect after restarting the server.'
            : 'This backend does not advertise MTP support.'}
      </small>
      {draft.mtp === 'model' && (
        <small>Requires MTP components included in the selected model.</small>
      )}
      {draft.mtp === 'file' && (
        <div className="model-file-selection">
          {draft.mtp_file ? (
            <details>
              <summary>{fileName(draft.mtp_file)}</summary>
              <code>{draft.mtp_file}</code>
            </details>
          ) : (
            <small>Choose an MTP GGUF compatible with the selected model.</small>
          )}
          <button
            disabled={!!override || !externalSupported}
            onClick={() => void chooseModelFile('mtp')}
          >
            {draft.mtp_file ? 'Change MTP file…' : 'Choose MTP file…'}
          </button>
        </div>
      )}
      <ChangedSetting field="mtp" />
      <ChangedSetting field="mtp_file" />
      <FieldError id="mtp-error" message={error} />
    </div>
  );
}
