import { useEffect, useId, useState } from 'react';
import Select from '../../components/Select';
import Feedback from '../../components/Feedback';
import { formatBytes } from '../../domain/huggingFace';
import type { Configuration } from '../../domain/types';
import type { HuggingFaceController } from './useHuggingFace';
import ModelsFolderActions, { useModelsFolderInfo } from './ModelsFolderActions';

export default function HuggingFaceBrowser({
  controller,
  config,
  onConfigured,
  onTokenSettings,
}: {
  controller: HuggingFaceController;
  config: Configuration | null;
  onConfigured: (value: Configuration) => void;
  onTokenSettings: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState('');
  const [projector, setProjector] = useState('');
  const [revision, setRevision] = useState('main');
  const [notice, setNotice] = useState('');
  const { repository, results, busy, error } = controller;
  const { info, error: diskError } = useModelsFolderInfo(config?.modelsDir ?? '');
  useEffect(() => {
    setPicked(
      repository?.variants.find(
        (variant) => variant.path === repository.suggestedFile && !variant.error,
      )?.path ??
        repository?.variants.find((variant) => !variant.error)?.path ??
        '',
    );
    setProjector('');
    setRevision(repository?.revision ?? 'main');
  }, [repository]);
  const selected = repository?.variants.find((variant) => variant.path === picked);
  const extra = repository?.variants.find(
    (variant) => variant.path === projector && projector !== picked,
  );
  const bytes = (selected?.size ?? 0) + (extra?.size ?? 0);
  const insufficient =
    info?.freeBytes !== null && info?.freeBytes !== undefined && info.freeBytes < bytes;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://huggingface.co/${repository!.id}`);
      setNotice('Repository link copied. Open it in your browser to review access and licensing.');
    } catch {
      setNotice(
        `Open https://huggingface.co/${repository!.id} in your browser to review access and licensing.`,
      );
    }
  }
  return (
    <div className="hf-browser">
      {!config?.modelsDir && (
        <div className="hf-callout">
          <strong>Choose where to keep models</strong>
          <ModelsFolderActions path="" onConfigured={onConfigured} />
        </div>
      )}
      <form
        className="hf-search"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.search(query);
        }}
      >
        <input
          aria-label="Search Hugging Face"
          placeholder="Model name, publisher/repository or Hugging Face link"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      <p className="field-help">
        Search GGUF repositories or paste a link. Nothing is sent until you search.
      </p>
      {busy && <p role="status">Loading…</p>}
      {error && (
        <Feedback
          title="Hugging Face action failed"
          details={error}
          onDismiss={() => controller.setError('')}
        >
          {error}
          <button onClick={onTokenSettings}>Token settings</button>
        </Feedback>
      )}
      {(results?.warning || repository?.warning) && (
        <p className="hf-callout warn">{repository?.warning || results?.warning}</p>
      )}
      {!repository && results && (
        <div aria-label="Hugging Face search results">
          <h3>Search results</h3>
          {!results.repositories.length && (
            <p>No GGUF repositories found. Try another name or paste a repository link.</p>
          )}
          {results.repositories.map((result) => (
            <button
              key={result.id}
              className="hf-result"
              disabled={busy}
              onClick={() => void controller.openRepository(result.id)}
            >
              <strong>{result.id}</strong>
              {result.gated && <span className="hf-badge gated">Gated</span>}
              <small>{result.downloads.toLocaleString('en-US')} downloads</small>
            </button>
          ))}
        </div>
      )}
      {repository && (
        <section aria-label="Repository details">
          <button className="text-button" onClick={() => controller.setRepository(null)}>
            Back to results
          </button>
          <h3>{repository.id}</h3>
          <details>
            <summary>Repository revision</summary>
            <p className="hf-meta">
              Pinned commit: <code>{repository.revision}</code>
            </p>
            <div className="hf-search">
              <input
                aria-label="Repository branch, tag or commit"
                value={revision}
                onChange={(event) => setRevision(event.target.value)}
              />
              <button
                disabled={busy || !revision.trim()}
                onClick={() => void controller.openRepository(repository.id, revision.trim())}
              >
                Open revision
              </button>
            </div>
          </details>
          <div className={`hf-callout${repository.gated ? ' warn' : ''}`}>
            {repository.gated
              ? 'This repository requires license acceptance or publisher approval. Use an authorized read token, then retry access.'
              : 'Check the publisher’s model card and license before downloading.'}
            <div className="row-actions">
              <button onClick={() => void copyLink()}>Copy repository link</button>
              <button onClick={onTokenSettings}>Token settings</button>
              {repository.gated && (
                <button
                  disabled={busy}
                  onClick={() => void controller.openRepository(repository.id, revision)}
                >
                  Retry access
                </button>
              )}
            </div>
          </div>
          {notice && (
            <p role="status" className="field-help">
              {notice}
            </p>
          )}
          <fieldset className="hf-variants" disabled={busy}>
            <legend>Model version</legend>
            {!repository.variants.length && <p>This revision has no GGUF files.</p>}
            {repository.variants.map((variant) => (
              <label
                key={variant.path}
                className={`hf-file${picked === variant.path ? ' is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name={`${id}-version`}
                  value={variant.path}
                  disabled={!!variant.error}
                  checked={picked === variant.path}
                  onChange={() => {
                    setPicked(variant.path);
                    if (projector === variant.path) setProjector('');
                  }}
                />
                <span className="q">{variant.label}</span>
                <span>{formatBytes(variant.size)}</span>
                <small>
                  {variant.error ??
                    `${variant.parts} ${variant.parts === 1 ? 'file' : 'parts'} · SHA-256 available`}
                </small>
              </label>
            ))}
          </fieldset>
          <label className="setting-field">
            <span>Optional mmproj file</span>
            <Select
              aria-label="Optional mmproj file"
              value={projector}
              disabled={busy}
              onChange={setProjector}
              options={[
                { value: '', label: 'None' },
                ...repository.variants
                  .filter((variant) => variant.path !== picked)
                  .map((variant) => ({
                    value: variant.path,
                    label: variant.label,
                    disabled: !!variant.error,
                  })),
              ]}
            />
            <small>
              Lets this model read images in chat. Saved next to the model and loaded with it.
            </small>
          </label>
          {selected && (
            <p className="field-help">
              Estimated memory: {formatBytes(selected.size)}
              {config?.memory.availableRamMiB == null
                ? '. Available RAM: unavailable.'
                : ` of ${formatBytes(config.memory.availableRamMiB * 1024 ** 2)} available.`}{' '}
              Actual use depends on context and devices.
            </p>
          )}
          <p className="field-help">
            Download: {formatBytes(bytes)}. Free disk space:{' '}
            {info?.freeBytes == null ? 'Unavailable' : formatBytes(info.freeBytes)}.
          </p>
          {diskError && <p className="hf-callout warn">{diskError}</p>}
          {insufficient && (
            <p role="alert" className="hf-callout error">
              There is not enough disk space. Choose another models folder or free space.
            </p>
          )}
          <button
            className="primary-button"
            disabled={busy || !selected || !!selected.error || !config?.modelsDir || insufficient}
            onClick={() =>
              void controller.download([
                picked,
                ...(projector && projector !== picked ? [projector] : []),
              ])
            }
          >
            Download selected files
          </button>
        </section>
      )}
    </div>
  );
}
