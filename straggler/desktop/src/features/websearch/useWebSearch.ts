import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri, listen } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { UiPreferences } from '../../domain/types';
import type { WebQuota, WebSearchStatus } from '../../domain/webSearch';

export function useWebSearch(
  preferences: UiPreferences,
  onPreferences: (patch: Partial<UiPreferences>) => void | Promise<void>,
  onKeyChanged: () => void,
) {
  const [status, setStatus] = useState<WebSearchStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (remote = false) => {
    if (!isTauri()) return;
    try {
      setStatus(await invoke<WebSearchStatus>('web_search_status', { refresh: remote }));
      setError('');
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const pending = listen<WebQuota>('web_search:quota', ({ payload }) =>
      setStatus((previous) => (previous ? { ...previous, quota: payload } : previous)),
    );
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, []);
  async function selectProvider(provider: string) {
    setBusy(true);
    setError('');
    try {
      await onPreferences({ webSearchProvider: provider });
      onKeyChanged();
      await refresh(true);
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveKey(key: string | null) {
    setBusy(true);
    setError('');
    try {
      setStatus(await invoke<WebSearchStatus>('web_search_key_save', { key }));
      onKeyChanged();
      await refresh(key !== null);
      return true;
    } catch (failure) {
      setError(errorDetail(failure).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return {
    status,
    error,
    busy,
    refresh,
    saveKey,
    selectProvider,
    preferences,
    onPreferences,
    provider: status?.providers.find((provider) => provider.id === status.selected),
    maxSearches: preferences.webSearchMaxSearches ?? 3,
  };
}
export type WebSearchController = ReturnType<typeof useWebSearch>;
