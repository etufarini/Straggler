import { useEffect, useRef, useState } from 'react';
import { saveChatDefaults } from '../../services/desktop';
import { chatDefaults, chatDefaultKeys } from '../../domain/chatDefaults';
import type { ChatDefaultKey, ChatDefaultValues } from '../../domain/chatDefaults';
import { errorDetail } from '../../domain/errors';
import type { SettingsController } from './useSettings';

export default function useChatDefaults(controller: SettingsController) {
  const [values, setValues] = useState(() => chatDefaults(controller.config.settings));
  const [errors, setErrors] = useState<Partial<Record<ChatDefaultKey, string>>>({});
  const [failure, setFailure] = useState('');
  const pending = useRef(new Map<ChatDefaultKey, string>());
  const current = useRef(values);
  const saving = useRef(new Map<ChatDefaultKey, number | undefined>());
  const failedFields = useRef(new Set<ChatDefaultKey>());
  const revisions = useRef(new Map<ChatDefaultKey, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accept = useRef(controller.acceptChatDefaults);
  accept.current = controller.acceptChatDefaults;

  function save(patch: Partial<ChatDefaultValues>) {
    const submitted = Object.entries(patch) as [ChatDefaultKey, string][];
    const versions = new Map(submitted.map(([key]) => [key, revisions.current.get(key)]));
    for (const [key, value] of submitted) {
      saving.current.set(key, versions.get(key));
      if (pending.current.get(key) === value) pending.current.delete(key);
    }
    async function persist() {
      try {
        const saved = await saveChatDefaults(patch);
        for (const [key] of submitted) {
          if (saving.current.get(key) === versions.get(key)) saving.current.delete(key);
          if (revisions.current.get(key) === versions.get(key)) failedFields.current.delete(key);
        }
        accept.current(saved);
        if (!failedFields.current.size) setFailure('');
        setErrors((previous) => {
          const next = { ...previous };
          for (const [key] of submitted) {
            if (revisions.current.get(key) === versions.get(key)) delete next[key];
          }
          return next;
        });
      } catch (error) {
        for (const [key, value] of submitted) {
          if (saving.current.get(key) === versions.get(key)) saving.current.delete(key);
          if (revisions.current.get(key) === versions.get(key)) pending.current.set(key, value);
        }
        const detail = errorDetail(error);
        if (detail.field) {
          const field = detail.field as ChatDefaultKey;
          if (revisions.current.get(field) === versions.get(field))
            setErrors((previous) => ({ ...previous, [field]: detail.message }));
        } else {
          for (const [key] of submitted) {
            if (revisions.current.get(key) === versions.get(key)) failedFields.current.add(key);
          }
          if (failedFields.current.size) setFailure(detail.message);
        }
      }
    }
    void persist();
  }

  function flush() {
    clearTimeout(timer.current);
    // Validate/save individual text fields separately, so one invalid edit does not block others.
    for (const [key, value] of pending.current) save({ [key]: value });
  }

  function change(patch: Partial<ChatDefaultValues>, immediately = false) {
    current.current = { ...current.current, ...patch };
    setValues(current.current);
    for (const [key, value] of Object.entries(patch) as [ChatDefaultKey, string][]) {
      pending.current.set(key, value);
      revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1);
    }
    setErrors((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(patch) as ChatDefaultKey[]) delete next[key];
      return next;
    });
    if (immediately) save(patch);
    else {
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    }
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      for (const [key, value] of pending.current) save({ [key]: value });
    },
    [],
  );

  function reset(settings: Parameters<typeof chatDefaults>[0]) {
    clearTimeout(timer.current);
    pending.current.clear();
    saving.current.clear();
    failedFields.current.clear();
    current.current = chatDefaults(settings);
    setValues(current.current);
    setErrors({});
    setFailure('');
  }

  // Parent state changes after a successful save; keep invalid or newer text in its field.
  const accepted = useRef(chatDefaults(controller.config.settings));
  useEffect(() => {
    const saved = chatDefaults(controller.config.settings);
    const next = { ...current.current };
    for (const key of chatDefaultKeys) {
      if (
        current.current[key] === accepted.current[key] &&
        !pending.current.has(key) &&
        !saving.current.has(key)
      ) {
        Object.assign(next, { [key]: saved[key] });
      }
    }
    accepted.current = saved;
    current.current = next;
    setValues(next);
  }, [controller.config.settings]);

  return { values, errors, failure, change, flush, reset };
}
