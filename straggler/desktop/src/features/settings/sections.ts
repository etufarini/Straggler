import type { Settings } from '../../domain/types';

export type Section =
  | 'overview'
  | 'model-files'
  | 'chat-defaults'
  | 'cloud'
  | 'prompts'
  | 'model'
  | 'performance'
  | 'server'
  | 'profiles'
  | 'folders'
  | 'huggingface'
  | 'websearch'
  | 'llama';

export function fieldSection(field?: keyof Settings): Section {
  if (
    field &&
    [
      'chat_system_prompt',
      'chat_reasoning',
      'temperature',
      'top_p',
      'top_k',
      'min_p',
      'repeat_penalty',
      'presence_penalty',
      'frequency_penalty',
      'seed',
      'max_tokens',
    ].includes(field)
  )
    return 'chat-defaults';
  if (field === 'port') return 'server';
  if (
    field &&
    [
      'mtp',
      'mtp_file',
      'device',
      'threads',
      'gpu_layers',
      'prompt_processing',
      'split_mode',
      'tensor_split',
      'fit_target',
    ].includes(field)
  )
    return 'performance';
  return 'model';
}

// Legacy destinations stay at the UI boundary; persisted Settings are unchanged.
export function settingsDestination(section: Section): { section: Section; target?: string } {
  switch (section) {
    case 'performance':
      return { section: 'model', target: 'model-speed' };
    case 'server':
      return { section: 'model', target: 'model-server' };
    case 'profiles':
      return { section: 'model', target: 'manage-configurations' };
    case 'folders':
    case 'huggingface':
      return {
        section: 'model-files',
        target: section === 'huggingface' ? 'hf-token' : 'models-folder',
      };
    default:
      return { section };
  }
}
