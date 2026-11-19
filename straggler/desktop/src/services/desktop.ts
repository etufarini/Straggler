import { documentTypes } from '../domain/attachments';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { approximatePromptTokens, approximateTokens, attachmentTypes } from '../domain/attachments';
import type { Attachment, Conversation, ProjectPassage } from '../domain/types';
import type { BackendRelease } from '../domain/backendRelease';
import { projectTokenEstimateCharacters } from '../domain/projectContext';
import type {
  Project,
  ProjectMutation,
  ProjectConversationMutation,
  ProjectDeletion,
  ProjectUndo,
} from '../domain/projects';
import { save as nativeSave, open as nativeOpen } from '@tauri-apps/plugin-dialog';
import {
  Channel as NativeChannel,
  invoke as nativeInvoke,
  isTauri as nativeAvailable,
} from '@tauri-apps/api/core';
import { getCurrentWindow as nativeWindow } from '@tauri-apps/api/window';
import { listen as nativeListen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { Scenario } from './fixtures';

// Fixture code is loaded only by the development server and is excluded from releases.
const scenario = import.meta.env.DEV ? new URLSearchParams(location.search).get('scenario') : null;
const fixture = scenario
  ? import('./fixtures').then((module) => {
      if (!module.scenarios.includes(scenario as Scenario))
        throw new Error(`Unknown development scenario: ${scenario}`);
      return module.createFixture(scenario as Scenario);
    })
  : null;
export const isTauri = () => !!fixture || nativeAvailable();
export const isFixture = () => !!fixture;

export type DesktopCommand =
  | 'web_search_status'
  | 'web_search_key_save'
  | 'open_web_url'
  | 'preferences_read'
  | 'preferences_save'
  | 'configuration'
  | 'backend_release'
  | 'apply_settings'
  | 'workspace_action'
  | 'choose_model_file'
  | 'choose_models_folder'
  | 'create_models_folder'
  | 'models_folder_info'
  | 'hf_token_status'
  | 'hf_token_save'
  | 'hf_search'
  | 'hf_repository'
  | 'hf_download_start'
  | 'hf_downloads'
  | 'hf_download_control'
  | 'hf_pause_all'
  | 'start_server'
  | 'server_status'
  | 'server_details'
  | 'stop_server'
  | 'generate'
  | 'cancel_generation'
  | 'temporary_begin'
  | 'temporary_finish'
  | 'temporary_attachment_add'
  | 'temporary_attachment_remove'
  | 'tokenize_text'
  | 'prompt_tokens'
  | 'attachment_add'
  | 'attachment_remove'
  | 'attachment_download'
  | 'read_conversation_import'
  | 'history_create'
  | 'history_branch'
  | 'write_export'
  | 'history_list'
  | 'history_save'
  | 'history_delete'
  | 'projects_list'
  | 'project_search'
  | 'project_file_text'
  | 'project_save'
  | 'project_file_add'
  | 'project_file_remove'
  | 'project_move_chat'
  | 'project_delete'
  | 'project_undo';

export async function invoke<T = void>(
  command: DesktopCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  if (fixture) return (await fixture).invoke(command, args) as Promise<T>;
  if (!nativeAvailable())
    throw new Error('Native desktop services are unavailable in this preview.');
  return nativeInvoke<T>(command, args);
}

export function getBackendRelease(): Promise<BackendRelease> {
  return invoke<BackendRelease>('backend_release');
}

export class Channel<T> {
  private native = fixture ? null : new NativeChannel<T>();
  private receive: (value: T) => void = () => {};
  set onmessage(callback: (value: T) => void) {
    this.receive = callback;
    if (this.native) this.native.onmessage = callback;
  }
  get onmessage() {
    return this.receive;
  }
  toJSON() {
    return this.native?.toJSON();
  }
}

export function getCurrentWindow() {
  if (!fixture) return nativeWindow();
  return {
    onCloseRequested: async (callback: (event: { preventDefault: () => void }) => void) => {
      const close = () => callback({ preventDefault: () => {} });
      window.addEventListener('straggler-fixture-close', close);
      return () => window.removeEventListener('straggler-fixture-close', close);
    },
    destroy: async () => {},
  };
}

export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!fixture) return nativeListen<T>(event, handler);
  const listener = (value: Event) => handler({ payload: (value as CustomEvent<T>).detail });
  window.addEventListener(`straggler-fixture-event:${event}`, listener);
  return Promise.resolve(() =>
    window.removeEventListener(`straggler-fixture-event:${event}`, listener),
  );
}

// DOM visibility and native window state are distinct lifecycle contracts.
// Window state is read only; background focus loss alone does not pause animation.
export async function watchWindowVisibility(
  onVisibility: (visible: boolean) => void,
  onError: (error: unknown) => void,
): Promise<UnlistenFn> {
  if (fixture || !nativeAvailable()) return () => {};
  const window = nativeWindow();
  let disposed = false;
  let checking = false;
  async function updateVisibility() {
    if (disposed || checking) return;
    checking = true;
    try {
      const [visible, minimized] = await Promise.all([window.isVisible(), window.isMinimized()]);
      if (!disposed) onVisibility(visible && !minimized);
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      checking = false;
    }
  }
  const subscriptions = await Promise.allSettled([
    window.onResized(() => void updateVisibility()),
    window.onFocusChanged(() => void updateVisibility()),
  ]);
  const events = subscriptions
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const failure = subscriptions.find((result) => result.status === 'rejected');
  if (failure) {
    disposed = true;
    events.forEach((unlisten) => unlisten());
    throw failure.reason;
  }
  void updateVisibility();
  // Some native hide/minimize transitions produce neither a DOM visibility event
  // nor a focus event. A bounded native check covers those transitions too.
  const timer = setInterval(() => void updateVisibility(), 1000);
  return () => {
    disposed = true;
    clearInterval(timer);
    events.forEach((unlisten) => unlisten());
  };
}

export async function saveConversationExport(
  defaultPath: string,
  contents: string,
): Promise<boolean> {
  const path = fixture
    ? (await fixture).chooseSavePath(defaultPath)
    : await nativeSave({
        title: 'Export chat',
        defaultPath,
        filters: [{ name: 'JSON chat', extensions: ['json'] }],
      });
  if (!path) return false;
  await invoke('write_export', { path, contents });
  return true;
}

export async function chooseConversationImport(): Promise<string | null> {
  if (fixture) return (await fixture).chooseImportPath();
  return nativeOpen({
    title: 'Import chat',
    multiple: false,
    directory: false,
    filters: [{ name: 'JSON chat', extensions: ['json'] }],
  });
}

export async function addAttachment(id: string, path: string) {
  return invoke<Conversation>('attachment_add', { id, path });
}
export async function removeAttachment(id: string, attachmentId: string) {
  return invoke<Conversation>('attachment_remove', { id, attachmentId });
}
export async function downloadAttachment(id: string, attachment: Attachment): Promise<boolean> {
  const destination = fixture
    ? (await fixture).chooseSavePath(attachment.name)
    : await nativeSave({ title: 'Download attachment', defaultPath: attachment.name });
  if (!destination) return false;
  await invoke('attachment_download', { id, attachmentId: attachment.id, destination });
  return true;
}

export type { DragDropEvent };
export async function chooseAttachmentFiles(project = false): Promise<string[]> {
  if (fixture) return (await fixture).chooseAttachmentFiles();
  const paths = await nativeOpen({
    title: 'Attach files',
    multiple: true,
    directory: false,
    filters: [
      {
        name: project ? 'Documents' : 'Documents and images',
        extensions: [...(project ? documentTypes : attachmentTypes)],
      },
    ],
  });
  return paths || [];
}
export async function watchAttachmentDrop(
  handler: (event: DragDropEvent) => void,
): Promise<UnlistenFn> {
  if (fixture) return (await fixture).watchAttachmentDrop(handler);
  if (!nativeAvailable()) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => handler(event.payload));
}
export interface TokenEstimate {
  tokens: number;
  source: 'server' | 'approximate';
  templated?: boolean;
}
export async function estimateTextTokens(content: string): Promise<TokenEstimate> {
  try {
    return { tokens: await invoke<number>('tokenize_text', { content }), source: 'server' };
  } catch {
    return { tokens: approximateTokens(content), source: 'approximate' };
  }
}
export async function estimatePromptTokens(
  messages: { role: string; content: string }[],
): Promise<TokenEstimate> {
  try {
    const result = await invoke<{ tokens: number; templated: boolean }>('prompt_tokens', {
      messages,
    });
    return { ...result, source: 'server' };
  } catch {
    return {
      tokens: approximatePromptTokens(messages),
      source: 'approximate',
    };
  }
}

export const projectService = {
  list: () => invoke<Project[]>('projects_list'),
  search: (projectId: string, query: string, budget: number) =>
    invoke<ProjectPassage[]>('project_search', { projectId, query, budget }),
  fileText: (projectId: string, fileId: string) =>
    invoke<string>('project_file_text', { projectId, fileId }),
  save: (project: Project) => invoke<ProjectMutation>('project_save', { project }),
  addFile: (projectId: string, path: string, replaceFileId?: string) =>
    invoke<ProjectMutation>('project_file_add', {
      projectId,
      replaceFileId,
      path,
      charactersPerToken: projectTokenEstimateCharacters,
    }),
  removeFile: (projectId: string, fileId: string) =>
    invoke<ProjectMutation>('project_file_remove', { projectId, fileId }),
  moveChat: (conversationId: string, projectId: string | null) =>
    invoke<ProjectConversationMutation>('project_move_chat', { conversationId, projectId }),
  delete: (projectId: string, deleteChats: boolean) =>
    invoke<ProjectDeletion>('project_delete', { projectId, deleteChats }),
  undo: (token: string) => invoke<ProjectUndo>('project_undo', { token }),
};

export async function openWebUrl(url: string): Promise<void> {
  await invoke('open_web_url', { url });
}
