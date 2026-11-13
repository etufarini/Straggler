export interface Model {
  path: string;
  label: string;
}
export interface Settings {
  chat_system_prompt: string;
  chat_reasoning: 'auto' | 'on' | 'off';
  chat_reasoning_effort: string;
  model: string;
  context: string;
  port: string;
  device: string;
  threads: string;
  gpu_layers: string;
  prompt_processing: string;
  cache_type_k: string;
  cache_type_v: string;
  split_mode: string;
  tensor_split: string;
  fit_target: string;
  temperature: string;
  top_p: string;
  top_k: string;
  min_p: string;
  repeat_penalty: string;
  presence_penalty: string;
  frequency_penalty: string;
  seed: string;
  max_tokens: string;
}
export interface Listener {
  pid: number;
  identity: string;
  details: string;
}
export interface Memory {
  availableRamMiB: number | null;
  devices: { name: string; availableMiB: number }[];
}
export interface Confirmation {
  title: string;
  text: string;
  action: () => Promise<void>;
  actionLabel: string;
  destructive?: boolean;
  alternative?: { label: string; action: () => Promise<void> };
}
export interface Configuration {
  llamaDir: string;
  modelsDir: string;
  serverAvailable: boolean;
  bundledAvailable: boolean;
  appStore: boolean;
  port: number;
  portStatus: string;
  warning: string;
  models: Model[];
  settings: Settings;
  generationPreset: string;
  presets: Record<string, string[]>;
  devices: { name: string; label: string }[];
  listeners: Listener[];
  memory: Memory;
  build: {
    tag?: string;
    backend?: string;
    commit?: string;
    previous?: string;
    version?: string;
    buildNumber?: number;
    releaseDate?: string | null;
  } | null;
  capabilities: {
    cacheTypesK: string[];
    cacheTypesV: string[];
    splitModes: string[];
    multipleDevices: boolean;
    buildNote: string;
  };
  profiles: string[];
  currentProfile: string | null;
  savedSettings: Settings | null;
  modified: boolean;
  restartRequired: boolean;
}
export interface ServerStatus {
  runId?: string;
  phase: 'stopped' | 'loading' | 'ready' | 'stopping' | 'error' | 'needs-restart';
  model: string | null;
  url: string | null;
  logs: string[];
  error: string | null;
  runningSettings?: Settings | null;
  issue: { kind: 'memory' | 'backend'; details: string } | null;
}
export type MessageStatus =
  'complete' | 'streaming' | 'stopped' | 'interrupted' | 'error' | 'length';
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  model?: string;
  status: MessageStatus;
  error?: string;
  metrics?: GenerationMetrics;
  serverRunId?: string;
}
export interface Attachment {
  id: string;
  name: string;
  extension: 'txt' | 'md' | 'docx' | 'xlsx' | 'pptx' | 'pdf';
  size: number;
  text: string;
}
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  messages: Message[];
  options?: ChatOptions;
  attachments?: Attachment[];
  projectId?: string | null;
  ownSystemPrompt?: string | null;
}
export interface Delta {
  metrics?: GenerationMetrics;
  content: string;
  reasoning: string;
}
export interface Response extends Delta {
  status: MessageStatus;
  error: string | null;
}

export const emptyServer: ServerStatus = {
  phase: 'stopped',
  model: null,
  url: null,
  logs: [],
  error: null,
  issue: null,
};
export const serverActive = (server: ServerStatus) =>
  ['ready', 'loading', 'stopping', 'needs-restart'].includes(server.phase);
export const fileName = (path: string) => path.split('/').pop() || path;
export const equalSettings = (a: Settings, b: Settings) =>
  Object.keys(a).every((key) => a[key as keyof Settings] === b[key as keyof Settings]);
export const chatSettingKeys = [
  'chat_system_prompt',
  'chat_reasoning',
  'chat_reasoning_effort',
] as const;
export const sameServerConfiguration = (a: Settings, b: Settings) =>
  Object.keys(a).every(
    (key) =>
      (chatSettingKeys as readonly string[]).includes(key) ||
      a[key as keyof Settings] === b[key as keyof Settings],
  );
export const samplingKeys = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'repeat_penalty',
  'presence_penalty',
  'frequency_penalty',
] as const;
export function samplingPreset(settings: Settings, presets: Record<string, string[]>) {
  return (
    Object.keys(presets).find((name) =>
      samplingKeys.every((key, index) => settings[key] === presets[name][index]),
    ) || 'custom'
  );
}
export function newConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: 'New conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model: null,
    messages: [],
  };
}
export function requestMessages(messages: Message[]) {
  // Empty or failed assistant placeholders must not become chat template input.
  const result: { role: Message['role']; content: string }[] = [];
  for (const message of messages) {
    if (!message.content.trim() || (message.role === 'assistant' && message.status === 'error'))
      continue;
    const previous = result[result.length - 1];
    if (previous?.role === message.role) previous.content += `\n\n${message.content}`;
    else result.push({ role: message.role, content: message.content });
  }
  return result;
}

export interface UiPreferences {
  sidebarCollapsed: boolean;
  presenceExpanded: boolean | null;
}

export interface ServerDetails {
  runId: string;
  contextSize: number | null;
  reasoningSupported: boolean | null;
  effortLevels: string[];
  systemRoleSupported: boolean | null;
  error: string | null;
}
export interface GenerationMetrics {
  contextTokens?: number;
  contextSource?: 'usage' | 'timings';
  outputTokens?: number;
  tokensPerSecond?: number;
  generationMs?: number;
  promptMs?: number;
  runId?: string;
}
export interface ChatOptions {
  systemPrompt: string | null;
  reasoning: 'auto' | 'on' | 'off' | null;
  effort: string | null;
}
