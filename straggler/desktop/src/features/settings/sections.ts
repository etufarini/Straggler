import type { Settings } from '../../domain/types';

export type Section =
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
