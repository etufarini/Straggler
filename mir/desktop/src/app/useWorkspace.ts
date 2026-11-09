import { useConversation } from '../features/chat/useConversation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri, getCurrentWindow, listen } from '../services/desktop';
import { equalSettings, emptyServer } from '../domain/types';
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
  const [copied, setCopied] = useState('');
  const mounted = useRef(true);
  const closeAction = useRef<() => void>(() => {});
  const native = isTauri();
  const {
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
    end,
    follow,
    textarea,
    updateChat,
    loadHistory,
    save,
    cancel,
    send,
    openConversation,
  } = useConversation(server, setError);

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
        if (!value.serverAvailable || !value.modelsDir) setPanel('settings');
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

  closeAction.current = () =>
    setConfirmation({
      title: 'Close Mir.cpp?',
      text: 'Any active response will be stopped and saved. Active builds will be canceled and the server started by this app will be shut down.',
      action: async () => {
        await invoke('cancel_build');
        await stop();
        await saveQueue.current;
        await getCurrentWindow().destroy();
      },
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
      setError(String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy || !selected) return;
    if (['ready', 'loading', 'stopping'].includes(server.phase)) {
      setConfirmation({
        title: 'Restart server?',
        text: 'Stop the current server and load the selected configuration? Any active response will be stopped and saved.',
        action: async () => {
          await stop();
          await launch();
        },
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

  const active =
    server.phase === 'ready' || server.phase === 'loading' || server.phase === 'stopping';
  const displayModel = active ? server.model : selected;
  const canSend =
    native && server.phase === 'ready' && historyReady && !storageError && !generating && !busy;

  return {
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
    save,
    loadHistory,
    draft,
    setDraft,
    acceptConfiguration,
    confirm,
    setJob,
    follow,
    textarea,
    setCopied,
    copied,
    end,
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
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
