import type { Settings } from '../../domain/types';

export type Section =
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
