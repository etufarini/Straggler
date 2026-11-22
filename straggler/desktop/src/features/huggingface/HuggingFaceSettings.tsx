import { settingsForModel } from '../../domain/types';
import { useEffect, useState } from 'react';
import { invoke } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { HubTokenStatus } from '../../domain/huggingFace';
import type { SettingsController } from '../settings/useSettings';
import ModelsFolderActions from './ModelsFolderActions';
import Feedback from '../../components/Feedback';

export default function HuggingFaceSettings({ controller }: { controller: SettingsController }) {
  const [status, setStatus] = useState<HubTokenStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function readStatus() {
    try {
      setStatus(await invoke<HubTokenStatus>('hf_token_status'));
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  useEffect(() => {
    void readStatus();
  }, []);
  async function save(remove: boolean) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setStatus(
        await invoke<HubTokenStatus>('hf_token_save', { token: remove ? null : token.trim() }),
      );
      setToken('');
      setMessage(
        remove ? 'Token removed from the system keychain.' : 'Token saved in the system keychain.',
      );
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>
        Access token <small>Optional</small>
      </h3>
      <p className="field-help">
        Only needed for gated or private repositories you’ve been granted access to.
      </p>
      <p role="status">
        {status?.available === false
          ? 'Token status unavailable.'
          : status?.saved
            ? 'A token is stored in the system keychain.'
            : 'No saved token.'}
      </p>
      <label className="setting-field">
        <span>Hugging Face token</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="hf_…"
        />
        <small>Stored only in the system keychain and never shown again.</small>
      </label>
      <div className="row-actions">
        <button disabled={busy || !token.trim()} onClick={() => void save(false)}>
          Save token
        </button>
        <button disabled={busy || !status?.saved} onClick={() => void save(true)}>
          Remove token
        </button>
        <button disabled={busy} onClick={() => void readStatus()}>
          Check keychain
        </button>
      </div>
      {(error || status?.error) && (
        <Feedback title="System keychain unavailable" details={error || status?.error || ''}>
          {error || status?.error} Public downloads remain available.
        </Feedback>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      <h3>Models folder</h3>
      <code>{controller.config.modelsDir || 'Not configured'}</code>
      <ModelsFolderActions
        path={controller.config.modelsDir}
        onConfigured={(value) => {
          controller.accept(value);
          controller.setDraft(settingsForModel(controller.draft, value.settings.model));
        }}
      />
    </>
  );
}
