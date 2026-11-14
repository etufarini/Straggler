import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { Configuration } from '../../domain/types';
import type { ModelsFolderInfo } from '../../domain/huggingFace';
import Feedback from '../../components/Feedback';

export function useModelsFolderInfo(path: string) {
  const [info, setInfo] = useState<ModelsFolderInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    if (isTauri())
      void invoke<ModelsFolderInfo>('models_folder_info')
        .then((value) => {
          if (!disposed) {
            setInfo(value);
            setError(value.error ?? '');
          }
        })
        .catch((failure) => {
          if (!disposed) setError(errorDetail(failure).message);
        });
    return () => {
      disposed = true;
    };
  }, [path]);
  return { info, error };
}

export default function ModelsFolderActions({
  path,
  onConfigured,
}: {
  path: string;
  onConfigured: (value: Configuration) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { info } = useModelsFolderInfo(path);
  async function choose(create: boolean) {
    setBusy(true);
    setError('');
    try {
      const value = await invoke<Configuration | null>(
        create ? 'create_models_folder' : 'choose_models_folder',
      );
      if (value) onConfigured(value);
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="models-folder-actions">
      <div className="row-actions">
        <button disabled={busy || !isTauri()} onClick={() => void choose(true)}>
          Create models folder
        </button>
        <button disabled={busy || !isTauri()} onClick={() => void choose(false)}>
          Choose existing folder
        </button>
      </div>
      <p className="field-help">
        Create a folder in Straggler's application data directory, or link a folder you already use.
        Existing GGUF files stay in place.
      </p>
      {info && (
        <small className="hf-path-hint">
          Default: <code>{info.defaultPath}</code>
        </small>
      )}
      {error && (
        <Feedback title="Models folder could not be updated" details={error}>
          {error}
        </Feedback>
      )}
    </div>
  );
}
