import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import {
  equalSettings,
  sameServerConfiguration,
  samplingPreset,
  serverActive,
} from '../../domain/types';
import type { SettingsFailure } from '../../domain/errors';
import type { Section } from './sections';
import type {
  ServerDetails,
  Configuration,
  Confirmation,
  JobStatus,
  Listener,
  ServerStatus,
  Settings as Values,
} from '../../domain/types';
export function useSettings({
  config,
  draft,
  setDraft,
  server,
  job,
  accept,
  confirm,
  onError,
  onBack,
  onJob,
  section,
  setSection,
  failure,
  onClearError,
  serverDetails,
}: {
  config: Configuration;
  serverDetails: ServerDetails | null;
  draft: Values;
  setDraft: (value: Values) => void;
  server: ServerStatus;
  job: JobStatus;
  accept: (value: Configuration) => void;
  confirm: (value: Confirmation) => void;
  onError: (error: unknown) => void;
  onBack: () => void;
  onJob: (value: JobStatus) => void;
  section: Section;
  setSection: (section: Section) => void;
  failure: SettingsFailure | null;
  onClearError: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState(config.currentProfile || config.profiles[0] || '');
  const [name, setName] = useState('');
  const [folder, setFolder] = useState<'llama' | 'models' | null>(null);
  const [backend, setBackend] = useState(config.build?.backend || 'cpu');
  const [version, setVersion] = useState('latest');
  const [tag, setTag] = useState('');
  const [jobs, setJobs] = useState('2');
  const [forceTargets, setForceTargets] = useState<Listener[]>([]);
  const [showSampling, setShowSampling] = useState(false);
  useEffect(() => {
    setForceTargets([]);
  }, [draft.port]);
  const native = isTauri();
  const active = serverActive(server);
  const building = ['running', 'stopping'].includes(job.phase);
  const dirty = !equalSettings(draft, config.settings);
  const modified = config.savedSettings ? !equalSettings(draft, config.savedSettings) : false;
  const restart =
    !!server.runningSettings && !sameServerConfiguration(draft, server.runningSettings);
  const preset = samplingPreset(draft, config.presets);
  const change = (key: keyof Values, value: string) => setDraft({ ...draft, [key]: value });
  const fieldError = (key: keyof Values) =>
    failure?.field === key && failure.value === draft[key] ? failure.message : undefined;

  async function apply() {
    const value = await invoke<Configuration>('apply_settings', { settings: draft });
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

  async function requestBuild(update = false) {
    setBusy(true);
    setMessage('');
    onClearError();
    try {
      const selectedBackend = update ? config.build?.backend || backend : backend;
      const release =
        update || version === 'latest'
          ? (
              await invoke<{ tag: string }>('workspace_action', {
                action: 'latest',
                arguments: [],
                targets: [],
              })
            ).tag
          : tag;
      if (update && release === config.build?.tag) {
        setMessage(`llama.cpp ${release} is already up to date.`);
        return;
      }
      const plan = await invoke<{ packages: string[] }>('workspace_action', {
        action: 'build-plan',
        arguments: [selectedBackend],
        targets: [],
      });
      confirm({
        title: 'Build llama.cpp?',
        actionLabel: 'Build llama.cpp',
        text: `Download and compile ${release} (${selectedBackend}) with ${jobs} compiler jobs? The working build will be kept until verification succeeds.${plan.packages.length ? ` Required packages: ${plan.packages.join(', ')}. Installation requests any required system authorization.` : ''}`,
        action: async () => {
          await invoke('start_build', { tag: release, backend: selectedBackend, jobs });
          onJob({ phase: 'running', logs: [], error: null });
        },
      });
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  function stopListeners(force: boolean) {
    const targets = force ? forceTargets : config.listeners;
    confirm({
      title: force
        ? 'Force these programs to quit?'
        : `Close the programs using port ${draft.port}?`,
      actionLabel: force ? 'Force quit' : 'Close programs',
      destructive: true,
      text: `${force ? 'They stop at once (SIGKILL) and may lose unsaved work.' : 'Mir.cpp asks them to close normally (SIGTERM). Anything that depends on them may stop working.'}\n\n${targets.map((target) => target.details).join('\n')}`,
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
    serverDetails,
    config,
    draft,
    setDraft,
    server,
    job,
    accept,
    confirm,
    onError,
    onBack,
    onJob,
    section,
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
    backend,
    setBackend,
    version,
    setVersion,
    tag,
    setTag,
    jobs,
    setJobs,
    forceTargets,
    showSampling,
    setShowSampling,
    native,
    active,
    building,
    dirty,
    modified,
    restart,
    preset,
    change,
    apply,
    run,
    operation,
    saveProfile,
    requestSave,
    requestBuild,
    stopListeners,
    failure,
    fieldError,
  };
}
export type SettingsController = ReturnType<typeof useSettings>;
export type SettingsProps = Parameters<typeof useSettings>[0];
