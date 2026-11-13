import { useServerDetails } from '../features/server/useServerDetails';
import { useUiPreferences } from './useUiPreferences';
import { useConversation } from '../features/chat/useConversation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri, getCurrentWindow, listen } from '../services/desktop';
import { equalSettings, emptyServer, serverActive } from '../domain/types';
import { errorDetail, settingsFailure as describeSettingsFailure } from '../domain/errors';
import type { SettingsFailure } from '../domain/errors';
import { fieldSection } from '../features/settings/sections';
import type { Section } from '../features/settings/sections';
import type {
  Configuration,
  ServerStatus,
  Settings,
  JobStatus,
  Confirmation,
} from '../domain/types';
type Panel = 'models' | 'settings' | 'logs' | null;
export function useWorkspace() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [server, setServer] = useState<ServerStatus>(emptyServer);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [job, setJob] = useState<JobStatus>({ phase: 'idle', logs: [], error: null });
  const configRef = useRef<Configuration | null>(null);
  const jobPhase = useRef('idle');
  const firstConfiguration = useRef(true);
  const selected = draft?.model || '';
  function setSelected(model: string) {
    setDraft((current) => (current ? { ...current, model } : current));
  }
  function acceptConfiguration(value: Configuration) {
    configRef.current = value;
    setConfig(value);
    setDraft(value.settings);
  }
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [settingsFailure, setSettingsFailure] = useState<SettingsFailure | null>(null);
  const [settingsSection, setSettingsSection] = useState<Section>('model');
  const mounted = useRef(true);
  const closeAction = useRef<() => void>(() => {});
  const native = isTauri();
  const ui = useUiPreferences();
  const {
    generationPhase,
    setChatOptions,
    conversations,
    setConversations,
    chat,
    input,
    setInput,
    storageError,
    historyReady,
    generating,
    chatRef,
    sendPromise,
    saveQueue,
    messageList,
    follow,
    textarea,
    updateChat,
    loadHistory,
    save,
    cancel,
    send,
    openConversation,
  } = useConversation(server, config?.settings);
  const serverDetails = useServerDetails(server);

  function reviewSettings(section: Section) {
    setSettingsSection(section);
    setPanel('settings');
  }

  function reportSettingsError(error: unknown) {
    const failure = describeSettingsFailure(error, draft);
    setSettingsFailure({ ...failure, section: settingsSection });
    if (failure.field) reviewSettings(fieldSection(failure.field));
  }

  const loadConfiguration = useCallback(async () => {
    try {
      const value = await invoke<Configuration>('configuration');
      if (!mounted.current) return;
      const previous = configRef.current;
      setConfig(value);
      setDraft((current) =>
        !current || (previous && equalSettings(current, previous.settings))
          ? value.settings
          : current,
      );
      configRef.current = value;
      if (firstConfiguration.current) {
        firstConfiguration.current = false;
        if (!value.serverAvailable || !value.modelsDir) {
          setSettingsSection(!value.serverAvailable ? 'llama' : 'folders');
          setPanel('settings');
        }
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!native)
      return () => {
        mounted.current = false;
      };
    void loadConfiguration();
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let ticks = 0;
    async function poll() {
      try {
        const [value, build] = await Promise.all([
          invoke<ServerStatus>('server_status'),
          invoke<JobStatus>('job_status'),
        ]);
        if (!disposed) {
          setServer(value);
          setJob(build);
          if (
            (['running', 'stopping'].includes(jobPhase.current) &&
              ['ready', 'failed', 'canceled'].includes(build.phase)) ||
            (value.phase === 'ready' && ++ticks % 5 === 0)
          )
            void loadConfiguration();
          jobPhase.current = build.phase;
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
      if (!disposed) timer = setTimeout(poll, 1000);
    }
    void poll();
    const close = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      closeAction.current();
    });
    const shutdownError = listen<string>('shutdown-error', (event) => setError(event.payload));
    return () => {
      disposed = true;
      mounted.current = false;
      clearTimeout(timer);
      void close.then((unlisten) => unlisten());
      void shutdownError.then((unlisten) => unlisten());
    };
  }, [loadConfiguration, native]);

  useEffect(() => {
    if ((!panel || panel === 'settings') && !confirmation) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      confirmation ? '[role="alertdialog"]' : '[role="dialog"]',
    );
    dialog?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirmBusy) {
        if (confirmation) setConfirmation(null);
        else setPanel(null);
      }
      if (event.key !== 'Tab') return;
      const nodes = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [panel, confirmation, confirmBusy]);

  useEffect(() => {
    setConfirmError('');
  }, [confirmation]);

  async function stop() {
    await cancel();
    await sendPromise.current;
    await invoke('stop_server');
    setServer(await invoke<ServerStatus>('server_status'));
  }

  function requestStop() {
    setConfirmation({
      title: 'Stop server?',
      destructive: true,
      text: 'Shut down the local server? Conversations are kept.',
      actionLabel: 'Stop server',
      action: stop,
    });
  }

  closeAction.current = () =>
    setConfirmation({
      title: 'Close Mir.cpp?',
      destructive: true,
      text: 'Any active response will be stopped and saved. Active builds will be canceled and the server started by this app will be shut down.',
      action: async () => {
        await invoke('cancel_build');
        await stop();
        await saveQueue.current;
        await ui.preferenceSaveQueue.current;
        await getCurrentWindow().destroy();
      },
      actionLabel: 'Close Mir.cpp',
    });

  async function launch() {
    if (!draft || !selected) return;
    setBusy(true);
    setError('');
    try {
      const applied = await invoke<Configuration>('apply_settings', { settings: draft });
      acceptConfiguration(applied);
      await invoke('start_server', { model: selected });
      setServer(await invoke<ServerStatus>('server_status'));
      setPanel(null);
    } catch (e) {
      if (errorDetail(e).field) reportSettingsError(e);
      else setError(errorDetail(e).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy || !selected) return;
    if (serverActive(server)) {
      setConfirmation({
        title: 'Restart server?',
        destructive: true,
        text: 'Stop the current server and load the selected configuration? Any active response will be stopped and saved.',
        action: async () => {
          await stop();
          await launch();
        },
        actionLabel: 'Restart server',
      });
    } else {
      await launch().catch(() => {});
    }
  }

  async function confirm() {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmation.action();
      setConfirmation(null);
    } catch (e) {
      setConfirmError(String(e));
    } finally {
      setConfirmBusy(false);
    }
  }

  const active = serverActive(server);
  const displayModel = active ? server.model : selected;
  const canSend =
    native && server.phase === 'ready' && historyReady && !storageError && !generating && !busy;

  return {
    ...ui,
    generationPhase,
    setChatOptions,
    serverDetails,
    generating,
    updateChat,
    setInput,
    setPanel,
    panel,
    config,
    conversations,
    chat,
    openConversation,
    setConfirmation,
    saveQueue,
    setConversations,
    chatRef,
    server,
    displayModel,
    active,
    busy,
    stop,
    native,
    selected,
    job,
    start,
    error,
    setError,
    storageError,
    historyReady,
    save,
    loadHistory,
    draft,
    setDraft,
    acceptConfiguration,
    confirm,
    setJob,
    follow,
    textarea,
    messageList,
    canSend,
    send,
    sendPromise,
    input,
    cancel,
    loadConfiguration,
    setSelected,
    confirmation,
    confirmError,
    confirmBusy,
    requestStop,
    reviewSettings,
    settingsSection,
    setSettingsSection,
    settingsFailure,
    setSettingsFailure,
    reportSettingsError,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
