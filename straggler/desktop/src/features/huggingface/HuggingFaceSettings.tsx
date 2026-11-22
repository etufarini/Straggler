import { useState } from 'react';
import { invoke } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { HubTokenStatus } from '../../domain/huggingFace';
import type useHubTokenStatus from './useHubTokenStatus';
import StatusChip from '../../components/StatusChip';
import Feedback from '../../components/Feedback';

export default function HuggingFaceSettings({
  tokenStatus,
}: {
  tokenStatus: ReturnType<typeof useHubTokenStatus>;
}) {
  const { status, setStatus, readStatus } = tokenStatus;
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
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
        Hugging Face token <small>Optional</small>
      </h3>
      <p className="field-help">
        Only needed for gated or private repositories you’ve been granted access to.
      </p>
      <StatusChip live tone={status?.saved ? 'positive' : 'neutral'}>
        {status?.available === false
          ? 'Token status unavailable.'
          : status?.saved
            ? 'A token is stored in the system keychain.'
            : 'No token saved (optional)'}
      </StatusChip>
      <label className="setting-field">
        <span>Hugging Face token</span>
        <input
          id="hf-token"
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
      {(error || tokenStatus.error || status?.error) && (
        <Feedback
          title="System keychain unavailable"
          details={error || tokenStatus.error || status?.error || ''}
        >
          {error || tokenStatus.error || status?.error} Public downloads remain available.
        </Feedback>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
    </>
  );
}
