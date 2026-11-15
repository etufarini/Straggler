import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import Feedback from '../../components/Feedback';
import { openWebUrl } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import { webSearchError } from '../../domain/webSearch';
import type { WebSearchController } from './useWebSearch';

export default function WebSearchSettings({ controller }: { controller: WebSearchController }) {
  const { status, provider, busy, maxSearches, onPreferences, refresh } = controller;
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [linkError, setLinkError] = useState('');
  useEffect(() => {
    void refresh(true);
  }, [refresh]);
  async function save(remove: boolean) {
    setMessage('');
    if (await controller.saveKey(remove ? null : key.trim())) {
      setKey('');
      setMessage(
        remove
          ? 'Key removed from the system keychain.'
          : 'Key verified and saved in the system keychain.',
      );
    }
  }
  const quota = status?.quota;
  const percentage = quota?.limit ? (quota.used / quota.limit) * 100 : 0;
  const error = controller.error || status?.error || status?.errorKind || linkError;
  return (
    <>
      <h2>Web search</h2>
      <p className="field-help">
        When you turn on Web search in a message, the model can look things up on the web. Straggler
        sends only search queries and page addresses to the search service. Your conversations stay
        on this computer.
      </p>
      <h3>Service</h3>
      <p>
        {provider?.name ?? 'Loading service…'} <small>{provider?.planDescription}</small>
      </p>
      <h3>API key</h3>
      <p role="status">
        {status?.saved
          ? 'A key is stored in the system keychain.'
          : 'No key yet. Web search stays off until you add one.'}
      </p>
      <label className="setting-field">
        <span>{provider?.name} API key</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={provider?.keyPlaceholder}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={busy}
        />
        <small>
          Stored only in the operating system's keychain. The saved key is never shown again in this
          form.
        </small>
      </label>
      <div className="row-actions">
        <button
          type="button"
          disabled={!provider}
          onClick={() => {
            if (provider)
              void openWebUrl(provider.signupUrl).catch((failure) =>
                setLinkError(errorDetail(failure).message),
              );
          }}
        >
          Get a free key <ExternalLink size={12} />
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !key.trim() || !provider}
          onClick={() => void save(false)}
        >
          {busy ? 'Verifying…' : 'Save and verify'}
        </button>
        <button type="button" disabled={busy || !status?.saved} onClick={() => void save(true)}>
          Remove key
        </button>
      </div>
      {error && (
        <Feedback title={webSearchError(error, provider?.name)}>
          {webSearchError(error, provider?.name)} The saved key is kept if verification fails.
        </Feedback>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      {status?.saved && (
        <>
          <h3>Usage this month</h3>
          {quota ? (
            <>
              {quota.limit !== null && (
                <meter
                  className={`web-usage ${percentage >= 100 ? 'is-full' : percentage >= 80 ? 'is-high' : ''}`}
                  low={(quota.limit || 1) * 0.8}
                  high={(quota.limit || 1) * 0.99}
                  optimum={0}
                  min={0}
                  max={quota.limit || 1}
                  value={quota.used}
                  aria-label="Credits used this month"
                />
              )}
              <p>
                {quota.used.toLocaleString('en-US')}
                {quota.limit !== null ? ` of ${quota.limit.toLocaleString('en-US')}` : ''} credits
                used
                {quota.resets_on ? ` · resets ${quota.resets_on}` : ' · renewal date unavailable'}
              </p>
              {percentage >= 80 && (
                <p role="status" className="field-help">
                  {percentage >= 100
                    ? 'Monthly credits are used up.'
                    : 'At least 80% of this month’s credits have been used.'}
                </p>
              )}
            </>
          ) : (
            <p className="field-help">Usage is unavailable. You can still use the local model.</p>
          )}
        </>
      )}
      <p className="field-help">
        Pages are read on this computer, so local page reading is free. Repeating the same search
        within 15 minutes is free too. The search service may charge for page reading when local
        reading fails.
      </p>
      <fieldset className="choice-group">
        <legend>Searches per message</legend>
        <div className="segmented">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n}>
              <input
                type="radio"
                name="web-search-limit"
                value={n}
                checked={maxSearches === n}
                onChange={() => onPreferences({ webSearchMaxSearches: n })}
              />
              <span>
                {n}
                {n === 3 && <small>Default</small>}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="field-help">
        The model can search up to this many times for one message. Fewer searches use fewer
        credits.
      </p>
      <p className="field-help">Changes are saved automatically.</p>
    </>
  );
}
