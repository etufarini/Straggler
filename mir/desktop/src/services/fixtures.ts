import type {
  Configuration,
  Conversation,
  Delta,
  JobStatus,
  Settings,
  ServerStatus,
} from '../domain/types';
import { emptyServer } from '../domain/types';

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
  | 'interrupted';

// Development data deliberately uses generic device names and no personal paths.
export const defaultSettings: Settings = {
  model: '/fixture/models/example.gguf',
  context: 'auto',
  port: '9931',
  device: 'auto',
  threads: 'auto',
  gpu_layers: 'auto',
  prompt_processing: 'auto',
  cache_type_k: 'q4_0',
  cache_type_v: 'q4_0',
  split_mode: 'auto',
  tensor_split: 'auto',
  fit_target: 'auto',
  temperature: 'auto',
  top_p: 'auto',
  top_k: 'auto',
  min_p: 'auto',
  repeat_penalty: 'auto',
  presence_penalty: 'auto',
  frequency_penalty: 'auto',
  seed: 'auto',
  max_tokens: 'auto',
};

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
];

export function createFixture(scenario: Scenario) {
  let settings = { ...defaultSettings, model: scenario === 'empty' ? '' : defaultSettings.model };
  let status: ServerStatus = { ...emptyServer };
  let job: JobStatus = { phase: 'idle', logs: [], error: null };
  let llamaDir = scenario === 'empty' ? '' : '/fixture/llama.cpp';
  let modelsDir = scenario === 'empty' ? '' : '/fixture/models';
  let currentProfile: string | null = null;
  let savedSettings: Settings | null = null;
  const profiles = new Map<string, Settings>();
  const historyKey = `mir-fixture-${scenario}`;
  const history: Conversation[] = JSON.parse(localStorage.getItem(historyKey) || '[]');
  let failedWrites = scenario === 'save-error' ? 2 : 0;
  let finish: (() => void) | undefined;
  let occupied = scenario === 'occupied';

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
      serverAvailable: !!llamaDir,
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
      backends: [{ id: 'fixture', label: 'Example build backend' }],
      capabilities: {
        cacheTypesK: ['q4_0', 'f16'],
        cacheTypesV: ['q4_0', 'f16'],
        splitModes: ['layer', 'row'],
        multipleDevices: devices.length > 1,
      },
      build: null,
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
    switch (command) {
      case 'configuration':
        return configuration();
      case 'apply_settings': {
        const next = args.settings as Settings;
        // This is a fixture response; numeric validation belongs to the real bridge tests.
        if (next.threads === '0') throw new Error('CPU threads must be positive.');
        settings = structuredClone(next);
        return configuration();
      }
      case 'server_status':
        return structuredClone(status);
      case 'start_server':
        if (occupied) throw new Error(`Port ${settings.port}: IN USE`);
        status = {
          phase: 'ready',
          model: String(args.model),
          url: 'http://127.0.0.1:9931',
          logs: ['Fixture server ready'],
          error: null,
          runningSettings: structuredClone(settings),
        };
        return;
      case 'stop_server':
        status = { ...emptyServer };
        finish?.();
        return;
      case 'cancel_generation':
        finish?.();
        return;
      case 'job_status':
        return job;
      case 'start_build':
        job = { phase: 'ready', logs: ['Fixture build completed'], error: null };
        return;
      case 'cancel_build':
        job = { phase: 'canceled', logs: [], error: null };
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
          case 'latest':
            return { tag: 'b12345' };
          case 'build-plan':
            return { packages: [] };
          case 'build-log':
            return { logs: ['Fixture build output'] };
          case 'stop-listeners':
            if (values[0] === 'KILL') occupied = false;
            break;
          case 'restore':
            break;
          default:
            throw new Error(`Unknown fixture action: ${action}`);
        }
        return configuration();
      }
      case 'history_list':
        return structuredClone(history);
      case 'history_save': {
        if (failedWrites > 0) {
          failedWrites--;
          throw new Error('Disk is full');
        }
        const conversation = structuredClone(args.conversation as Conversation);
        const index = history.findIndex((value) => value.id === conversation.id);
        if (index === -1) history.push(conversation);
        else history[index] = conversation;
        persistHistory();
        return;
      }
      case 'history_delete':
        history.splice(
          history.findIndex((value) => value.id === args.id),
          1,
        );
        persistHistory();
        return;
      case 'generate': {
        if (scenario === 'model-error') throw new Error('Unsupported chat template');
        const delta: Delta = {
          content:
            'A **local** answer.\n\n```bash\necho hello\n```\n\n![remote](https://example.com/tracker.png)\n<script>alert(1)</script>',
          reasoning: 'Example reasoning text.',
        };
        const channel = args.onDelta as { onmessage: (delta: Delta) => void };
        channel.onmessage(delta);
        if (scenario === 'cancel')
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        else await new Promise((resolve) => setTimeout(resolve, 120));
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
  return { invoke };
}
