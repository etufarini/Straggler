import { useState } from 'react';
import { Cloud, ChevronDown, Plus } from 'lucide-react';
import type { CloudController } from './useCloudModels';
import { shownCloudModels } from '../../domain/cloudModels';
import type { CloudProvider } from '../../domain/cloudModels';
import WebLink from '../websearch/WebLink';
import Feedback from '../../components/Feedback';

export default function CloudSettings({ controller }: { controller: CloudController }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  return (
    <>
      <h2>Cloud models</h2>
      <p className="field-help">
        Optional services for chatting with models hosted elsewhere. Messages leave this computer
        only when you choose a cloud model and send.
      </p>
      <p className="field-help">
        Changes are saved automatically. Sampling settings apply to models on this computer only.
      </p>
      {controller.error && (
        <Feedback title="Couldn’t update cloud models" details={controller.error}>
          Local models remain available.{' '}
          <button onClick={() => void controller.reload()}>Reload cloud settings</button>
        </Feedback>
      )}
      <div className="cloud-providers">
        {controller.status.providers.map((provider) => (
          <ProviderSettings key={provider.id} provider={provider} controller={controller} />
        ))}
      </div>
      <button className="text-button" disabled={controller.busy} onClick={() => setAdding(!adding)}>
        <Plus size={15} />
        Add custom provider
      </button>
      {adding && (
        <form
          className="cloud-provider"
          onSubmit={(event) => {
            event.preventDefault();
            void controller
              .addProvider(name, url)
              .then(() => {
                setAdding(false);
                setName('');
                setUrl('');
              })
              .catch(() => {});
          }}
        >
          <p className="field-help">
            Any service that uses the OpenAI format. Not tested by Straggler.
          </p>
          <label className="setting-field">
            <span>Name</span>
            <input
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="setting-field">
            <span>Base URL</span>
            <input
              type="url"
              value={url}
              required
              placeholder="https://example.org/v1"
              onChange={(event) => setUrl(event.target.value)}
            />
            <small>
              HTTPS is required, except HTTP on loopback. No credentials or query parameters in the
              URL.
            </small>
          </label>
          <div className="row-actions">
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary-button" disabled={controller.busy} type="submit">
              Add provider
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function ProviderSettings({
  provider,
  controller,
}: {
  provider: CloudProvider;
  controller: CloudController;
}) {
  const signup = {
    deepseek: 'https://platform.deepseek.com/api_keys',
    openrouter: 'https://openrouter.ai/settings/keys',
    mistral: 'https://console.mistral.ai/',
  }[provider.kind as 'deepseek' | 'openrouter' | 'mistral'];
  const visibleCount = shownCloudModels(provider).length;
  const unlistedCount = provider.shown.length - visibleCount;
  const [key, setKey] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const models = provider.models.filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  async function saveKey() {
    try {
      await controller.saveKey(provider.id, key);
      setKey('');
      setNotice('Key verified and saved in the system keychain.');
    } catch {
      setNotice('');
    }
  }
  return (
    <details className="cloud-provider">
      <summary>
        <Cloud size={17} />
        <span>
          <strong>{provider.name}</strong>
          <small>
            {provider.saved
              ? `Key verified · ${visibleCount} ${visibleCount === 1 ? 'model' : 'models'} shown`
              : 'Not configured'}
          </small>
        </span>
        <span className="cloud-verified">
          {provider.kind === 'custom' ? 'Not tested by Straggler' : 'Verified'}
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="cloud-provider-content">
        <p className="field-help">{provider.baseUrl}</p>
        {signup && <WebLink url={signup}>Get a key from {provider.name}</WebLink>}
        <p className="field-help">Stored only in the system keychain and never shown again.</p>
        {provider.keyError && (
          <Feedback title="Couldn’t read the API key" details={provider.keyError}>
            Unlock your system keychain and try again.
          </Feedback>
        )}
        <label className="setting-field">
          <span>{provider.name} API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={provider.saved ? 'Enter a new key to replace it' : 'API key'}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <div className="row-actions">
          <button
            className="primary-button"
            disabled={controller.busy || !key}
            onClick={() => void saveKey()}
          >
            Save and verify
          </button>
          {provider.saved && (
            <button
              disabled={controller.busy}
              onClick={() =>
                void controller
                  .saveKey(provider.id, null)
                  .then(() => {
                    setKey('');
                    setNotice('Key removed from the system keychain.');
                  })
                  .catch(() => {})
              }
            >
              Remove key
            </button>
          )}
        </div>
        {notice && (
          <p className="success-message" role="status">
            {notice}
          </p>
        )}
        {provider.saved && (
          <>
            {unlistedCount > 0 && (
              <p className="field-help" role="status">
                {unlistedCount} previously selected{' '}
                {unlistedCount === 1 ? 'model isn’t' : 'models aren’t'} listed by the service and{' '}
                {unlistedCount === 1 ? 'doesn’t' : 'don’t'} appear in the picker. Your selection is
                kept for a future refresh.
              </p>
            )}
            <div className="project-section-head">
              <h3>Models to show</h3>
              <button
                className="text-button"
                disabled={controller.busy}
                onClick={() => void controller.refresh(provider.id).catch(() => {})}
              >
                Refresh models
              </button>
            </div>
            <label className="setting-field">
              <span>Find {provider.name} models</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="cloud-model-checks">
              {models.map((model) => (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    disabled={controller.busy}
                    checked={provider.shown.includes(model.id)}
                    onChange={(event) =>
                      void controller
                        .showModels(
                          provider.id,
                          event.target.checked
                            ? [...provider.shown, model.id]
                            : provider.shown.filter((id) => id !== model.id),
                        )
                        .catch(() => {})
                    }
                  />
                  <span>
                    {model.name}
                    <small>{model.id}</small>
                  </span>
                </label>
              ))}
              {!models.length && (
                <p className="field-help">
                  {query
                    ? 'No models match this search.'
                    : 'No models were listed by this service. Refresh models to check again.'}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
