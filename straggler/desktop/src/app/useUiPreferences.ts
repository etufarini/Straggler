import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '../services/desktop';
import { errorDetail } from '../domain/errors';
import type { UiPreferences } from '../domain/types';

export function useUiPreferences() {
  const [preferences, setPreferences] = useState<UiPreferences>({
    sidebarCollapsed: false,
    formattingToolbarVisible: true,
    presenceExpanded: null,
  });
  const [preferenceError, setPreferenceError] = useState('');
  const [preferencesReady, setPreferencesReady] = useState(!isTauri());
  const current = useRef(preferences);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let disposed = false;
    if (isTauri()) {
      void invoke<UiPreferences>('preferences_read')
        .then((value) => {
          if (!disposed) {
            current.current = value;
            setPreferences(value);
          }
        })
        .catch((error) => {
          if (!disposed) setPreferenceError(errorDetail(error).message);
        })
        .finally(() => {
          if (!disposed) setPreferencesReady(true);
        });
    }
    return () => {
      disposed = true;
    };
  }, []);

  const changePreferences = useCallback((patch: Partial<UiPreferences>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setPreferences(next);
    if (!isTauri()) return;
    const pending = queue.current
      .catch(() => {})
      .then(() => invoke('preferences_save', { preferences: next }));
    queue.current = pending;
    void pending
      .then(() => setPreferenceError(''))
      .catch((error) => setPreferenceError(errorDetail(error).message));
  }, []);
  return {
    preferences,
    preferencesReady,
    preferenceError,
    changePreferences,
    preferenceSaveQueue: queue,
  };
}
