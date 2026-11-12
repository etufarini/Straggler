import nativeDefaults from '../../src-tauri/src/configuration/defaults.json';
import backendManifest from '../../packaging/llama-runtime.json';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import type {
  Configuration,
  Conversation,
  Delta,
  Settings,
  ServerStatus,
  UiPreferences,
  ServerDetails,
} from '../domain/types';
import { emptyServer } from '../domain/types';
import { approximatePromptTokens, approximateTokens, attachmentTypes } from '../domain/attachments';
import { createProjectFixture } from './projectFixtures';

export type Scenario =
  | 'normal'
  | 'empty'
  | 'cpu'
  | 'multiple'
  | 'unknown-memory'
  | 'occupied'
  | 'save-error'
  | 'model-error'
  | 'cancel'
  | 'interrupted'
  | 'oom'
  | 'oom-startup'
  | 'oom-and-save-error'
  | 'backend-error'
  | 'history-error'
  | 'compute-error'
  | 'no-metrics'
  | 'no-reasoning'
  | 'effort-levels'
  | 'context-high'
  | 'context-full'
  | 'reasoning-stream';

// Development data deliberately uses generic device names and no personal paths.
export const defaultSettings = {
  ...nativeDefaults,
  model: '/fixture/models/example.gguf',
} as Settings;

export const scenarios: Scenario[] = [
  'normal',
  'empty',
  'cpu',
  'multiple',
  'unknown-memory',
  'occupied',
  'save-error',
  'model-error',
  'cancel',
  'interrupted',
  'oom',
  'oom-startup',
  'oom-and-save-error',
  'backend-error',
  'history-error',
  'compute-error',
  'no-metrics',
  'no-reasoning',
  'effort-levels',
  'context-high',
  'context-full',
  'reasoning-stream',
];

export function createFixture(scenario: Scenario) {
  let settings = { ...defaultSettings, model: scenario === 'empty' ? '' : defaultSettings.model };
  let status: ServerStatus = { ...emptyServer };
  let llamaDir = scenario === 'empty' ? '' : '/fixture/llama.cpp';
  const bundledAvailable = scenario !== 'empty';
  let modelsDir = scenario === 'empty' ? '' : '/fixture/models';
  let currentProfile: string | null = null;
  let savedSettings: Settings | null = null;
  const profiles = new Map<string, Settings>();
  const historyKey = `mir-fixture-${scenario}`;
  const history: Conversation[] = JSON.parse(localStorage.getItem(historyKey) || '[]');
  let failedWrites = scenario === 'save-error' ? 2 : 0;
  let finish: (() => void) | undefined;
  let occupied = scenario === 'occupied';
  let memoryFailureSeen = false;
  let generatingConversation: string | null = null;
  const projectFixture = createProjectFixture(
    `mir-fixture-projects-${scenario}`,
    history,
    persistHistory,
    () => generatingConversation,
  );

  function failMemory() {
    memoryFailureSeen = true;
    status = {
      ...status,
      phase: 'needs-restart',
      issue: { kind: 'memory', details: 'Insufficient Memory; backend is in error state' },
      logs: ['Insufficient Memory', 'backend is in error state - recreate the backend to recover'],
    };
  }

  function configuration(): Configuration {
    const devices =
      scenario === 'cpu'
        ? []
        : scenario === 'multiple'
          ? [
              { name: 'Device0', label: 'First accelerator' },
              { name: 'Device1', label: 'Second accelerator' },
            ]
          : [{ name: 'Device0', label: 'Example accelerator' }];
    return {
      llamaDir,
      modelsDir,
      serverAvailable: !!llamaDir || bundledAvailable,
      bundledAvailable,
      settings: structuredClone(settings),
      port: Number(settings.port),
      portStatus: `Port ${settings.port}: ${occupied ? 'IN USE' : 'FREE'}`,
      warning: '',
      generationPreset: 'default',
      presets: {
        default: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
        focused: ['0.6', '0.95', '20', '0', '1', '0', '0'],
        exploratory: ['1', '0.95', '20', '0', '1', '0', '0'],
        'min-p': ['1', '1', '0', '0.05', '1', '0', '0'],
      },
      models: scenario === 'empty' ? [] : [{ path: defaultSettings.model, label: 'example.gguf' }],
      devices,
      listeners: occupied
        ? [{ pid: 12345, identity: 'fixture-process', details: '12345 fixture Example listener' }]
        : [],
      memory: { availableRamMiB: scenario === 'unknown-memory' ? null : 8192, devices: [] },
      capabilities: {
        cacheTypesK: ['q4_0', 'f16'],
        cacheTypesV: ['q4_0', 'f16'],
        splitModes: ['layer', 'row'],
        multipleDevices: devices.length > 1,
        buildNote: 'Available features are advertised by the selected llama-server.',
      },
      build:
        !llamaDir && bundledAvailable
          ? {
              tag: backendManifest.tag,
              backend: 'bundled',
              commit: backendManifest.commit,
              previous: '',
            }
          : null,
      profiles: [...profiles.keys()],
      currentProfile,
      savedSettings,
      modified: savedSettings ? JSON.stringify(settings) !== JSON.stringify(savedSettings) : false,
      restartRequired: false,
    };
  }

  function persistHistory() {
    localStorage.setItem(historyKey, JSON.stringify(history));
  }

  async function invoke(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (command === 'projects_list' || command.startsWith('project_'))
      return projectFixture.invoke(command, args);
    switch (command) {
      case 'preferences_read':
        return JSON.parse(
          localStorage.getItem('mir-fixture-ui-preferences') ||
            '{"sidebarCollapsed":false,"presenceExpanded":null}',
        );
      case 'preferences_save':
        localStorage.setItem(
          'mir-fixture-ui-preferences',
          JSON.stringify(args.preferences as UiPreferences),
        );
        return;
      case 'configuration':
        return configuration();
      case 'apply_settings': {
        const next = args.settings as Settings;
        // This is a fixture response; numeric validation belongs to the real bridge tests.
        if (next.threads === '0')
          throw { field: 'threads', message: 'CPU threads must be positive.' };
        settings = structuredClone(next);
        return configuration();
      }
      case 'server_details':
        return {
          runId: status.runId!,
          contextSize: localStorage.getItem('mir-fixture-context-unavailable')
            ? null
            : Number(localStorage.getItem('mir-fixture-context-size')) || 4096,
          reasoningSupported: scenario !== 'no-reasoning',
          effortLevels:
            scenario === 'no-reasoning'
              ? []
              : scenario === 'effort-levels'
                ? ['minimal', 'xhigh']
                : ['low', 'medium', 'high'],
          systemRoleSupported: true,
          error: null,
        } satisfies ServerDetails;
      case 'server_status':
        return structuredClone(status);
      case 'start_server':
        if (occupied) throw new Error(`Port ${settings.port}: IN USE`);
        status = {
          phase: 'ready',
          runId: crypto.randomUUID(),
          model: String(args.model),
          url: 'http://127.0.0.1:9931',
          logs: ['Fixture server ready'],
          error: null,
          issue: null,
          runningSettings: structuredClone(settings),
        };
        if (scenario === 'oom-startup' && !memoryFailureSeen) failMemory();
        return;
      case 'stop_server':
        status = { ...status, phase: 'stopped', url: null, runningSettings: undefined };
        finish?.();
        return;
      case 'cancel_generation':
        finish?.();
        return;
      case 'workspace_action': {
        const action = String(args.action);
        const values = (args.arguments || []) as string[];
        const name = values[0];
        switch (action) {
          case 'save-profile':
            profiles.set(name, structuredClone(settings));
            currentProfile = name;
            savedSettings = structuredClone(settings);
            break;
          case 'load-profile':
            settings = structuredClone(profiles.get(name)!);
            currentProfile = name;
            savedSettings = structuredClone(settings);
            break;
          case 'delete-profile':
            profiles.delete(name);
            if (currentProfile === name) {
              currentProfile = null;
              savedSettings = null;
            }
            break;
          case 'set-path':
            if (name === 'models') modelsDir = values[1];
            else llamaDir = values[1];
            break;
          case 'browse':
            return {
              path: name || '/fixture',
              parent: '/',
              directories: [
                { name: 'models', path: '/fixture/models' },
                ...(values[1] === 'true' ? [{ name: '.hidden', path: '/fixture/.hidden' }] : []),
              ],
            };
          case 'use-bundled':
            if (scenario === 'backend-error')
              throw new Error('The bundled backend could not be selected.');
            llamaDir = '';
            break;
          case 'stop-listeners':
            if (values[0] === 'KILL') occupied = false;
            break;
          default:
            throw new Error(`Unknown fixture action: ${action}`);
        }
        return configuration();
      }
      case 'tokenize_text':
        if (status.phase !== 'ready' || localStorage.getItem('mir-fixture-tokenize-unavailable'))
          throw new Error('Tokenization unavailable');
        return approximateTokens(String(args.content));
      case 'prompt_tokens': {
        if (status.phase !== 'ready' || localStorage.getItem('mir-fixture-tokenize-unavailable'))
          throw new Error('Tokenization unavailable');
        const messages = args.messages as { content: string }[];
        return {
          tokens:
            Number(localStorage.getItem('mir-fixture-prompt-tokens')) ||
            approximatePromptTokens(messages),
          templated: true,
        };
      }
      case 'attachment_add': {
        while (localStorage.getItem('mir-fixture-reading-paused'))
          await new Promise((resolve) => setTimeout(resolve, 20));
        const conversation = structuredClone(history.find((item) => item.id === args.id));
        if (!conversation) throw new Error('Conversation does not exist');
        const name = String(args.path).split('/').at(-1)!;
        const suffix = name.split('.').at(-1)!.toLowerCase();
        if (suffix === 'ppt')
          throw new Error(
            'PowerPoint 97–2003 (.ppt) is not supported. Save it as .pptx and add it again.',
          );
        const extension = attachmentTypes.find((type) => type === suffix);
        if (!extension) throw new Error('This file type is not supported.');
        const text = `Extracted fixture text from ${name}.`;
        conversation.attachments = [
          ...(conversation.attachments || []),
          { id: crypto.randomUUID(), name, extension, size: 1234, text },
        ];
        conversation.updatedAt = Date.now();
        history[history.findIndex((item) => item.id === args.id)] = conversation;
        persistHistory();
        return conversation;
      }
      case 'attachment_remove': {
        const conversation = structuredClone(history.find((item) => item.id === args.id));
        if (!conversation) throw new Error('Conversation does not exist');
        conversation.attachments = conversation.attachments?.filter(
          (item) => item.id !== args.attachmentId,
        );
        history[history.findIndex((item) => item.id === args.id)] = conversation;
        persistHistory();
        return conversation;
      }
      case 'attachment_download':
        localStorage.setItem('mir-fixture-download', String(args.attachmentId));
        return;
      case 'read_conversation_import':
        if (localStorage.getItem('mir-fixture-import-error'))
          throw new Error('Message 2 has an unsupported role: tool.');
        return {
          title: 'Imported conversation',
          createdAt: '2026-11-10T00:00:00Z',
          model: 'imported.gguf',
          systemPrompt: 'Imported instructions',
          messages: [
            { role: 'user', content: 'Imported question', reasoning: '', model: null },
            {
              role: 'assistant',
              content: 'Imported answer',
              reasoning: 'Imported reasoning',
              model: 'imported.gguf',
            },
          ],
        };
      case 'write_export':
        if (localStorage.getItem('mir-fixture-write-error'))
          throw new Error('Destination is not writable');
        localStorage.setItem('mir-fixture-export', String(args.contents));
        return;
      case 'history_list':
        if (
          scenario === 'history-error' &&
          localStorage.getItem('mir-fixture-history-recovered') !== 'true'
        ) {
          throw new Error('Conversation storage is unavailable');
        }
        return structuredClone(history);
      case 'history_create':
      case 'history_save': {
        if (localStorage.getItem('mir-fixture-fail-next-save') === 'true') {
          localStorage.removeItem('mir-fixture-fail-next-save');
          throw new Error('Disk is full');
        }
        if (failedWrites > 0) {
          failedWrites--;
          throw new Error('Disk is full');
        }
        const conversation = structuredClone(args.conversation as Conversation);
        const index = history.findIndex((value) => value.id === conversation.id);
        const previous = history[index];
        if (conversation.projectId && projectFixture.find(conversation.projectId).archived)
          throw new Error('Restore the project before making changes.');
        if (previous?.projectId && projectFixture.find(previous.projectId).archived)
          throw new Error('Restore the project before making changes.');
        if (previous && (previous.projectId ?? null) !== (conversation.projectId ?? null))
          throw new Error('Move the conversation through the project action before saving.');
        if (command === 'history_create' && index !== -1)
          throw new Error('Conversation already exists');
        if (index === -1) history.push(conversation);
        else history[index] = conversation;
        persistHistory();
        return;
      }
      case 'history_delete':
        projectFixture.assertChatWritable(history.find((value) => value.id === args.id)!);
        history.splice(
          history.findIndex((value) => value.id === args.id),
          1,
        );
        persistHistory();
        return;
      case 'generate': {
        localStorage.setItem('mir-fixture-request', JSON.stringify(args.request));
        const request = args.request as { conversationId?: string };
        if (request.conversationId) {
          const current = history.find((value) => value.id === request.conversationId);
          if (current?.projectId && projectFixture.find(current.projectId).archived)
            throw new Error('Restore this project to make changes.');
        }
        if (localStorage.getItem('mir-fixture-context-rejection'))
          throw new Error(
            'HTTP 400: {"error":{"code":400,"type":"exceed_context_size_error","message":"request (5000 tokens) exceeds the available context size (4096 tokens), try increasing it","n_prompt_tokens":5000,"n_ctx":4096}}',
          );
        if (scenario === 'compute-error') throw new Error('Compute error.');
        if (scenario === 'model-error') throw new Error('Unsupported chat template');
        generatingConversation = request.conversationId ?? null;
        const delta: Delta = {
          ...(scenario === 'no-metrics'
            ? {}
            : {
                metrics: {
                  contextTokens:
                    scenario === 'context-full' ? 3930 : scenario === 'context-high' ? 3360 : 212,
                  contextSource: 'usage' as const,
                  outputTokens: 35,
                  tokensPerSecond: 52.9,
                  generationMs: 661.1,
                  promptMs: 31,
                },
              }),
          content:
            'A **local** answer.\n\n```bash\necho hello\n```\n\n![remote](https://example.com/tracker.png)\n<script>alert(1)</script>',
          reasoning: 'Example reasoning text.',
        };
        const channel = args.onDelta as { onmessage: (delta: Delta) => void };
        if (scenario === 'reasoning-stream') {
          channel.onmessage({ content: '', reasoning: delta.reasoning });
          await new Promise((resolve) => setTimeout(resolve, 1200));
          channel.onmessage({ ...delta, reasoning: '' });
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } else channel.onmessage(delta);
        if (['oom', 'oom-and-save-error'].includes(scenario) && !memoryFailureSeen) {
          generatingConversation = null;
          failMemory();
          if (scenario === 'oom-and-save-error') failedWrites = 1;
          return { ...delta, status: 'error', error: 'Compute error.' };
        }
        if (scenario === 'cancel')
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        else await new Promise((resolve) => setTimeout(resolve, 120));
        generatingConversation = null;
        return {
          ...delta,
          status:
            scenario === 'cancel'
              ? 'stopped'
              : scenario === 'interrupted'
                ? 'interrupted'
                : 'complete',
          error: scenario === 'interrupted' ? 'Connection interrupted' : null,
        };
      }
      default:
        throw new Error(`Unexpected fixture command: ${command}`);
    }
  }
  function chooseSavePath(defaultPath: string) {
    localStorage.setItem('mir-fixture-save-name', defaultPath);
    const selected = localStorage.getItem('mir-fixture-save-path');
    return selected === 'cancel' ? null : selected || '/fixture/export.json';
  }
  function chooseImportPath() {
    return localStorage.getItem('mir-fixture-import-path') === 'cancel'
      ? null
      : '/fixture/import.json';
  }
  function chooseAttachmentFiles(): string[] {
    return JSON.parse(
      localStorage.getItem('mir-fixture-attachment-paths') || '["/fixture/meeting-notes.txt"]',
    );
  }
  function watchAttachmentDrop(handler: (event: DragDropEvent) => void) {
    const receive = (event: Event) => handler((event as CustomEvent<DragDropEvent>).detail);
    window.addEventListener('mir-fixture-drag-drop', receive);
    return () => window.removeEventListener('mir-fixture-drag-drop', receive);
  }
  return { invoke, chooseSavePath, chooseImportPath, chooseAttachmentFiles, watchAttachmentDrop };
}
