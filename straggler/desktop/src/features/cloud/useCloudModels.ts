import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import type { DesktopCommand } from '../../services/desktop';
import type { ActiveCloud, CloudSelection, CloudStatus } from '../../domain/cloudModels';
import type { UiPreferences } from '../../domain/types';
import { errorDetail } from '../../domain/errors';

export function useCloudModels(
  preferences: UiPreferences,
  onPreferences: (patch: Partial<UiPreferences>) => Promise<void>,
) {
  const [status, setStatus] = useState<CloudStatus>({ providers: [], active: null, error: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ActiveCloud | null>(null);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const current = useRef({ active: status.active, preferences, onPreferences });
  current.current = { active: status.active, preferences, onPreferences };
  const failedNoticeSaves = useRef(new Set<string>());
  const pending = useRef<{
    promise: Promise<boolean>;
    resolve: (accepted: boolean) => void;
  } | null>(null);
  async function reload() {
    try {
      const value = await invoke<CloudStatus>('cloud_status');
      setStatus(value);
      setError(value.error ?? '');
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  useEffect(() => {
    if (isTauri()) void reload();
    return () => pending.current?.resolve(false);
  }, []);
  async function run(command: DesktopCommand, args?: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const value = await invoke<CloudStatus>(command, args);
      setStatus(value);
      setError(value.error ?? '');
      return value;
    } catch (failure) {
      setError(errorDetail(failure).message);
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  function ensureConsent(): Promise<boolean> {
    const { active, preferences } = current.current;
    if (
      !active ||
      (preferences.cloudNoticeSeen?.[active.selection.providerId] === active.baseUrl &&
        !failedNoticeSaves.current.has(active.selection.providerId))
    )
      return Promise.resolve(true);
    if (pending.current) return pending.current.promise;
    let resolve!: (accepted: boolean) => void;
    const promise = new Promise<boolean>((complete) => {
      resolve = complete;
    });
    pending.current = { promise, resolve };
    setNotice(active);
    setNoticeError('');
    return promise;
  }
  function cancelNotice() {
    if (noticeBusy) return;
    pending.current?.resolve(false);
    pending.current = null;
    setNotice(null);
  }
  async function continueNotice() {
    if (!notice || noticeBusy) return;
    setNoticeBusy(true);
    try {
      await current.current.onPreferences({
        cloudNoticeSeen: {
          ...current.current.preferences.cloudNoticeSeen,
          [notice.selection.providerId]: notice.baseUrl,
        },
      });
      failedNoticeSaves.current.delete(notice.selection.providerId);
      pending.current?.resolve(true);
      pending.current = null;
      setNotice(null);
      setNoticeError('');
    } catch (failure) {
      failedNoticeSaves.current.add(notice.selection.providerId);
      setNoticeError(errorDetail(failure).message);
    } finally {
      setNoticeBusy(false);
    }
  }
  return {
    status,
    active: status.active,
    busy,
    error,
    reload,
    run,
    notice,
    noticeBusy,
    noticeError,
    cancelNotice,
    continueNotice,
    ensureConsent,
    addProvider: (name: string, baseUrl: string) => run('cloud_add_provider', { name, baseUrl }),
    saveKey: (providerId: string, key: string | null) => run('cloud_key_save', { providerId, key }),
    refresh: (providerId: string) => run('cloud_models_refresh', { providerId }),
    showModels: (providerId: string, shown: string[]) =>
      run('cloud_models_show', { providerId, shown }),
    useModel: (selection: CloudSelection) => run('cloud_use_model', { selection }),
  };
}
export type CloudController = ReturnType<typeof useCloudModels>;
