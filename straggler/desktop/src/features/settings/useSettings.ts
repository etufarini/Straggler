import { useEffect, useState } from 'react';
import { applySettings, invoke, isTauri } from '../../services/desktop';
import {
  equalSettings,
  settingsForModel,
  sameServerConfiguration,
  serverActive,
} from '../../domain/types';
import type { SettingsFailure } from '../../domain/errors';
import { settingsDestination } from './sections';
import type { Section } from './sections';
import type {
  ServerDetails,
  Configuration,
  Confirmation,
  Listener,
  ServerStatus,
  Settings as Values,
} from '../../domain/types';
export function useSettings({
  config,
  draft,
  setDraft,
  server,
  accept,
  acceptChatDefaults,
  confirm,
  onError,
  onBack,
  section,
  setSection,
  failure,
  onClearError,
  serverDetails,
  target,
}: {
  config: Configuration;
  serverDetails: ServerDetails | null;
  draft: Values;
  setDraft: (value: Values) => void;
  server: ServerStatus;
  accept: (value: Configuration) => void;
  acceptChatDefaults: (value: Configuration) => void;
  confirm: (value: Confirmation) => void;
  onError: (error: unknown) => void;
  onBack: () => void;
  target?: string;
  section: Section;
  setSection: (section: Section) => void;
  failure: SettingsFailure | null;
  onClearError: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState(config.currentProfile || config.profiles[0] || '');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(false);
  const [forceTargets, setForceTargets] = useState<Listener[]>([]);
  useEffect(() => {
    setForceTargets([]);
  }, [draft.port]);
  const native = isTauri();
  const active = serverActive(server);
  const dirty = !equalSettings(draft, config.settings);
  const modified = config.savedSettings ? !equalSettings(draft, config.savedSettings) : false;
  const restart =
    !!server.runningSettings && !sameServerConfiguration(draft, server.runningSettings);
  const change = (key: keyof Values, value: string) => {
    setDraft(key === 'model' ? settingsForModel(draft, value) : { ...draft, [key]: value });
    if (key === 'model' && draft.model !== value) {
      setMessage('Chat template and MTP reset for the selected model.');
    }
  };

  async function chooseModelFile(kind: 'template' | 'mtp') {
    await run(async () => {
      const path = await invoke<string | null>('choose_model_file', { kind });
      if (path === null) return;
      setDraft(
        kind === 'template'
          ? { ...draft, chat_template_file: path }
          : { ...draft, mtp: 'file', mtp_file: path },
      );
    });
  }
  const fieldError = (key: keyof Values) =>
    failure?.field === key && failure.value === draft[key] ? failure.message : undefined;

  async function apply() {
    const value = await applySettings(draft);
    accept(value);
    return value;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    onClearError();
    try {
      await action();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  async function operation(action: string, args: string[] = [], targets: Listener[] = []) {
    return invoke<Configuration>('workspace_action', { action, arguments: args, targets });
  }

  async function saveProfile(profileName: string, replace: boolean) {
    await apply();
    const value = await operation('save-profile', [profileName, replace ? 'replace' : 'new']);
    accept(value);
    setProfile(profileName);
    setMessage('Configuration saved.');
  }

  function requestSave() {
    const target = name.trim();
    if (config.profiles.includes(target))
      confirm({
        title: 'Replace configuration?',
        actionLabel: 'Replace configuration',
        destructive: true,
        text: `Replace “${target}” with the current settings?`,
        action: () => saveProfile(target, true),
      });
    else void run(() => saveProfile(target, false));
  }

  function stopListeners(force: boolean) {
    const targets = force ? forceTargets : config.listeners;
    confirm({
      title: force
        ? 'Force these programs to quit?'
        : `Close the programs using port ${draft.port}?`,
      actionLabel: force ? 'Force quit' : 'Close programs',
      destructive: true,
      text: `${force ? 'They stop at once (SIGKILL) and may lose unsaved work.' : 'Straggler asks them to close normally (SIGTERM). Anything that depends on them may stop working.'}\n\n${targets.map((target) => target.details).join('\n')}`,
      action: async () => {
        const value = await operation('stop-listeners', [force ? 'KILL' : 'TERM'], targets);
        accept(value);
        setForceTargets(
          force
            ? []
            : value.listeners.filter((listener) =>
                targets.some(
                  (target) => listener.pid === target.pid && listener.identity === target.identity,
                ),
              ),
        );
      },
    });
  }

  return {
    chooseModelFile,
    serverDetails,
    config,
    draft,
    setDraft,
    server,
    accept,
    acceptChatDefaults,
    confirm,
    onError,
    onBack,
    section: settingsDestination(section).section,
    target: target ?? settingsDestination(section).target,
    setSection,
    busy,
    message,
    setMessage,
    profile,
    setProfile,
    name,
    setName,
    folder,
    setFolder,
    forceTargets,
    native,
    active,
    dirty,
    modified,
    restart,
    change,
    apply,
    run,
    operation,
    saveProfile,
    requestSave,
    stopListeners,
    failure,
    fieldError,
  };
}
export type SettingsController = ReturnType<typeof useSettings>;
export type SettingsProps = Parameters<typeof useSettings>[0];
