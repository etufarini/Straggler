import { useWebSearch } from '../features/websearch/useWebSearch';
import { useServerDetails } from '../features/server/useServerDetails';
import { useUiPreferences } from './useUiPreferences';
import { useAttachments } from '../features/attachments/useAttachments';
import { useContextEstimate } from '../features/chat/useContextEstimate';
import { useConversation } from '../features/chat/useConversation';
import { useProjects } from '../features/projects/useProjects';
import { useHuggingFace } from '../features/huggingface/useHuggingFace';
import { containTabFocus } from '../components/focus';
import type { Conversation } from '../domain/types';
import { newConversation } from '../domain/types';
import { ownSystemPrompt } from '../domain/projects';
import { serializeStorage } from '../domain/storageQueue';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri, getCurrentWindow, listen } from '../services/desktop';
import { equalSettings, emptyServer, serverActive } from '../domain/types';
import { errorDetail, settingsFailure as describeSettingsFailure } from '../domain/errors';
import type { SettingsFailure } from '../domain/errors';
import { fieldSection } from '../features/settings/sections';
import type { Section } from '../features/settings/sections';
import type { Configuration, ServerStatus, Settings, Confirmation } from '../domain/types';
type Panel = 'models' | 'settings' | 'logs' | null;

export interface ProjectDialog {
  kind: 'create' | 'edit' | 'move' | 'instructions' | 'archive' | 'delete';
  id?: string;
  conversationId?: string;
}

export function useWorkspace() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [server, setServer] = useState<ServerStatus>(emptyServer);
  const [draft, setDraft] = useState<Settings | null>(null);
  const configRef = useRef<Configuration | null>(null);
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
  const [panel, updatePanel] = useState<Panel>(null);
  const [view, setView] = useState<'chat' | 'projects' | 'project'>('chat');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectDialog, updateProjectDialog] = useState<ProjectDialog | null>(null);
  function setProjectDialog(value: ProjectDialog | null, opener?: HTMLElement) {
    if (value && conversation.temporaryRef.current) {
      leaveTemporary(() => setProjectDialog(value, opener));
      return;
    }
    // WebKit does not focus clicked buttons; make the trigger available for focus restoration.
    opener?.focus({ preventScroll: true });
    updateProjectDialog(value);
  }
  const [reviewFiles, setReviewFiles] = useState(false);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({});
  const storageQueue = useRef<Promise<void>>(Promise.resolve());
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
  const serverDetails = useServerDetails(server);
  const projects = useProjects(storageQueue, server, config?.settings, serverDetails);
  const projectBusy = useRef(projects.busy);
  projectBusy.current = projects.busy;
  const conversation = useConversation(
    server,
    config?.settings,
    serverDetails?.runId === server.runId ? serverDetails?.contextSize : null,
    projects,
    storageQueue,
  );
  const webSearch = useWebSearch(
    ui.preferences,
    (patch) => {
      ui.changePreferences(patch);
      return ui.preferenceSaveQueue.current;
    },
    () => conversation.setWebSearchOn(false),
  );
  const currentProject = projects.projects.find(
    (project) => project.id === conversation.chat.projectId,
  );
  const attachments = useAttachments(
    conversation,
    server,
    view === 'chat' && panel !== 'settings',
    !!currentProject?.archived,
  );
  const contextEstimate = useContextEstimate(
    conversation.chat,
    conversation.input,
    config?.settings,
    server,
    serverDetails,
    currentProject,
  );
  const {
    chatOptionsDisabled,
    flushSaves,
    contextError,
    importChat: performImport,
    importBusy,
    importError,
    setImportError,
    exportChat,
    fileError,
    setFileError,
    fileNotice,
    editor,
    setEditor,
    editingBusy,
    beginEdit,
    saveEdit,
    regenerate,
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
  } = conversation;

  function setPanel(value: Panel) {
    if (value === 'settings' && conversation.temporaryRef.current) {
      leaveTemporary(() => updatePanel(value));
      return;
    }
    updatePanel(value);
  }

  function leaveTemporary(proceed: () => void | Promise<void>, closing = false) {
    if (!conversation.temporaryRef.current) {
      void Promise.resolve(proceed()).catch((failure) => setError(errorDetail(failure).message));
      return;
    }
    setConfirmation({
      title: closing ? 'Quit and erase this temporary chat?' : 'Erase this temporary chat?',
      text: `Messages, attachments and the draft will be erased. The temporary backend will be stopped to clear its caches.${closing ? ' Active model downloads will be paused.' : ''}`,
      actionLabel: closing ? 'Erase and quit' : 'Erase and leave',
      destructive: true,
      action: async () => {
        await conversation.finishTemporary(false, !closing);
        setServer(await invoke<ServerStatus>('server_status'));
        await proceed();
      },
      alternative: {
        label: 'Save chat',
        action: async () => {
          await conversation.finishTemporary(true, !closing);
          setServer(await invoke<ServerStatus>('server_status'));
          await proceed();
        },
      },
    });
  }

  async function beginTemporary() {
    if (conversation.temporaryRef.current) {
      leaveTemporary(beginTemporary);
      return;
    }
    if (busy || editingBusy || importBusy) return;
    setBusy(true);
    setError('');
    try {
      await cancel();
      await sendPromise.current;
      await flushSaves();
      const value = newConversation();
      await invoke('temporary_begin', { id: value.id });
      conversation.enterTemporary(value);
      setServer(await invoke<ServerStatus>('server_status'));
      updatePanel(null);
      setView('chat');
      textarea.current?.focus();
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemporary() {
    if (busy || chatOptionsDisabled) return;
    setBusy(true);
    setError('');
    try {
      await conversation.finishTemporary(true);
      setServer(await invoke<ServerStatus>('server_status'));
    } catch (failure) {
      setError(errorDetail(failure).message);
      setServer(await invoke<ServerStatus>('server_status'));
    } finally {
      setBusy(false);
    }
  }

  const temporaryShortcut = useRef(beginTemporary);
  temporaryShortcut.current = beginTemporary;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void temporaryShortcut.current();
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);

  async function importChat() {
    if (conversation.temporaryRef.current) {
      leaveTemporary(importChat);
      return;
    }
    const value = await performImport();
    if (value) {
      setView('chat');
      setPanel(null);
    }
  }

  function openProject(id: string, files = false) {
    if (conversation.temporaryRef.current) {
      leaveTemporary(() => openProject(id, files));
      return;
    }
    setProjectId(id);
    setView('project');
    setPanel(null);
    setReviewFiles(files);
  }
  function openProjects() {
    if (conversation.temporaryRef.current) {
      leaveTemporary(openProjects);
      return;
    }
    setView('projects');
    setPanel(null);
  }
  function openChat(value: Conversation) {
    if (conversation.temporaryRef.current && value.id !== conversation.temporaryRef.current) {
      leaveTemporary(() => openChat(value));
      return;
    }
    if (value.id === conversation.chatRef.current.id) {
      setView('chat');
      setPanel(null);
      return;
    }
    openConversation(value);
    if (!generating && !editingBusy) {
      setView('chat');
      setPanel(null);
    }
  }
  function startProjectChat(id: string, text: string) {
    if (generating || editingBusy || storageError || server.phase !== 'ready') return;
    const project = projects.current.current.find((value) => value.id === id);
    if (!project || project.archived || projects.context(project).level === 'over') return;
    const value = { ...newConversation(), projectId: id, ownSystemPrompt: null };
    openChat(value);
    setInput(text);
    const pending = send(undefined, text);
    setProjectDrafts((values) => ({ ...values, [id]: '' }));
    sendPromise.current = pending;
    void pending;
  }
  async function moveChat(value: Conversation, target: string | null) {
    if (value.id === chatRef.current.id) await save(chatRef.current);
    const previous = projects.current.current.find((project) => project.id === value.projectId);
    const result = await projects.moveChat(value.id, target);
    conversation.acceptStoredConversation(result.conversation);
    const destination = projects.current.current.find((project) => project.id === target);
    projects.setNotice({
      message: destination
        ? `Moved “${value.title}” to ${destination.name}.${ownSystemPrompt(value) !== null ? ' Its own system prompt is kept for later.' : ''}`
        : `Removed from ${previous?.name ?? 'project'}. ${ownSystemPrompt(value) !== null ? 'Its own system prompt is active again.' : 'It uses the system prompt from Settings.'}`,
      undoToken: result.undoToken,
    });
  }
  async function undoProjectAction(token: string) {
    const result = await projects.undo(token);
    if (result.conversation) conversation.acceptStoredConversation(result.conversation);
    projects.setNotice({ message: 'Undone.' });
  }
  function requestDeleteChat(value: Conversation) {
    setConfirmation({
      title: 'Delete conversation?',
      actionLabel: 'Delete conversation',
      destructive: true,
      text: `“${value.title}” will be permanently removed from this device.`,
      action: async () => {
        await serializeStorage(storageQueue, async () => {
          await invoke('history_delete', { id: value.id });
          setConversations((values) => values.filter((item) => item.id !== value.id));
          if (chatRef.current.id === value.id) updateChat(newConversation());
        });
      },
    });
  }

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
  const huggingFace = useHuggingFace(() => void loadConfiguration());

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
        const value = await invoke<ServerStatus>('server_status');
        if (!disposed) {
          setServer(value);
          if (value.phase === 'ready' && ++ticks % 5 === 0) void loadConfiguration();
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
    if ((!panel || panel === 'settings') && !confirmation && !projectDialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(
      confirmation
        ? '.confirmation-backdrop [role="alertdialog"]'
        : projectDialog
          ? '[data-project-dialog]'
          : '[role="dialog"]',
    );
    (
      dialog?.querySelector<HTMLElement>('[data-initial-focus]') ??
      dialog?.querySelector<HTMLElement>('button:not(:disabled)')
    )?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !confirmBusy) {
        if (confirmation) setConfirmation(null);
        else if (
          projectDialog &&
          !projectBusy.current &&
          dialog?.getAttribute('aria-busy') !== 'true'
        )
          setProjectDialog(null);
        else setPanel(null);
      }
      containTabFocus(event, dialog);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [panel, confirmation, confirmBusy, projectDialog]);

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
    conversation.temporaryRef.current
      ? leaveTemporary(async () => {
          await stop();
          await ui.preferenceSaveQueue.current;
          await invoke('hf_pause_all');
          await getCurrentWindow().destroy();
        }, true)
      : setConfirmation({
          title: 'Close Straggler?',
          destructive: true,
          text: 'Any active response will be stopped and saved. The server started by this app will be shut down. Active model downloads will be paused.',
          action: async () => {
            await stop();
            await flushSaves();
            await ui.preferenceSaveQueue.current;
            await invoke('hf_pause_all');
            await getCurrentWindow().destroy();
          },
          actionLabel: 'Close Straggler',
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

  async function confirm(alternative = false) {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await (alternative && confirmation.alternative
        ? confirmation.alternative.action()
        : confirmation.action());
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
    native &&
    server.phase === 'ready' &&
    (!!conversation.temporaryId || (historyReady && !storageError)) &&
    !chatOptionsDisabled &&
    !busy &&
    !editor &&
    !contextEstimate.overflow &&
    !currentProject?.archived &&
    (!chat.projectId ||
      (projects.ready &&
        !projects.error &&
        !!currentProject &&
        projects.context(currentProject).level !== 'over'));

  return {
    webSearch,
    webSearchOn: conversation.webSearchOn,
    setWebSearchOn: conversation.setWebSearchOn,
    huggingFace,
    temporary: !!conversation.temporaryId,
    beginTemporary,
    saveTemporary,
    projects,
    projectDrafts,
    setProjectDrafts,
    currentProject,
    view,
    setView,
    projectId,
    projectDialog,
    setProjectDialog,
    acceptStoredConversation: conversation.acceptStoredConversation,
    reviewFiles,
    setReviewFiles,
    openProject,
    openProjects,
    openChat,
    moveChat,
    undoProjectAction,
    requestDeleteChat,
    startProjectChat,
    ...ui,
    chatOptionsDisabled,
    attachments,
    contextEstimate,
    contextError,
    importChat,
    importBusy,
    importError,
    setImportError,
    exportChat,
    fileError,
    setFileError,
    fileNotice,
    editor,
    setEditor,
    editingBusy,
    beginEdit,
    saveEdit,
    regenerate,
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
