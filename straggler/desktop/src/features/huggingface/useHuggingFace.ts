import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { HubDownload, HubRepository, HubSearch } from '../../domain/huggingFace';

export function useHuggingFace(onCompleted: () => void) {
  const [downloads, setDownloads] = useState<HubDownload[]>([]);
  const [results, setResults] = useState<HubSearch | null>(null);
  const [repository, setRepository] = useState<HubRepository | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const completed = useRef<Set<string> | null>(null);
  const notify = useRef(onCompleted);
  notify.current = onCompleted;

  async function refreshDownloads() {
    try {
      const values = await invoke<HubDownload[]>('hf_downloads');
      if (!mounted.current) return;
      if (
        completed.current &&
        values.some((value) => value.phase === 'completed' && !completed.current!.has(value.id))
      )
        notify.current();
      completed.current = new Set(
        values.filter((value) => value.phase === 'completed').map((value) => value.id),
      );
      setDownloads(values);
    } catch (failure) {
      if (mounted.current) setError(errorDetail(failure).message);
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (isTauri()) void refreshDownloads();
    return () => {
      mounted.current = false;
    };
  }, []);

  const active = downloads.some((download) =>
    ['downloading', 'verifying', 'pausing', 'cancelling'].includes(download.phase),
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refreshDownloads(), 400);
    return () => clearInterval(timer);
  }, [active]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function search(query: string) {
    await run(async () => {
      const result = await invoke<HubSearch>('hf_search', { query });
      setResults(result);
      setRepository(result.direct);
    });
  }

  async function openRepository(id: string, revision = 'main') {
    await run(async () =>
      setRepository(await invoke<HubRepository>('hf_repository', { repository: id, revision })),
    );
  }

  async function download(files: string[]) {
    if (!repository) return;
    await run(async () => {
      await invoke('hf_download_start', {
        repository: repository.id,
        revision: repository.revision,
        files,
      });
      await refreshDownloads();
    });
  }

  async function control(id: string, action: 'pause' | 'resume' | 'cancel') {
    await run(async () => {
      await invoke('hf_download_control', { id, action });
      await refreshDownloads();
    });
  }

  return {
    downloads,
    results,
    repository,
    setRepository,
    busy,
    error,
    setError,
    search,
    openRepository,
    download,
    control,
  };
}

export type HuggingFaceController = ReturnType<typeof useHuggingFace>;
