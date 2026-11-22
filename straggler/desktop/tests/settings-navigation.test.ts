import { describe, expect, it } from 'vitest';
import { fieldSection, settingsDestination } from '../src/features/settings/sections';

describe('legacy settings destinations', () => {
  it('retains old callers while opening the corresponding current controls', () => {
    expect(settingsDestination('performance')).toEqual({ section: 'model', target: 'model-speed' });
    expect(settingsDestination('server')).toEqual({ section: 'model', target: 'model-server' });
    expect(settingsDestination('profiles')).toEqual({
      section: 'model',
      target: 'manage-configurations',
    });
    expect(settingsDestination('folders')).toEqual({
      section: 'model-files',
      target: 'models-folder',
    });
    expect(settingsDestination('huggingface')).toEqual({
      section: 'model-files',
      target: 'hf-token',
    });
    expect(settingsDestination('llama')).toEqual({ section: 'llama' });
    expect(settingsDestination(fieldSection('port')).section).toBe('model');
    expect(settingsDestination(fieldSection('threads')).section).toBe('model');
    expect(fieldSection('temperature')).toBe('chat-defaults');
  });
});
