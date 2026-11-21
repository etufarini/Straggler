import { expect, test } from 'vitest';
import { fieldScope } from '../src/domain/chatDefaults';
import type { CloudStatus, CloudProvider } from '../src/domain/cloudModels';
import generationParameters from './fixtures/generation-parameters.json';
import type { GenerationKey } from '../src/domain/chatDefaults';

function status(providers: [string, CloudProvider['kind']][]): CloudStatus {
  return {
    providers: providers.map(([name, kind]) => ({
      id: name,
      name,
      kind,
      baseUrl: 'https://example.test',
      saved: true,
      keyError: null,
      models: [],
      shown: [],
    })),
    active: null,
    error: null,
    generationParameters: generationParameters as Record<string, GenerationKey[]>,
  };
}

test('scope notes appear only for exceptions and choose the shorter provider list', () => {
  expect(fieldScope('seed', status([]))).toBeUndefined();
  expect(fieldScope('seed', status([['OpenRouter', 'openrouter']]))).toBeUndefined();
  expect(fieldScope('seed', status([['DeepSeek', 'deepseek']]))).toBe('This computer only');
  expect(
    fieldScope(
      'top_k',
      status([
        ['DeepSeek', 'deepseek'],
        ['OpenRouter', 'openrouter'],
      ]),
    ),
  ).toBe('Not sent to DeepSeek');
  expect(
    fieldScope(
      'min_p',
      status([
        ['An unusually long custom provider name', 'custom'],
        ['OpenRouter', 'openrouter'],
      ]),
    ),
  ).toBe('This computer and OpenRouter only');
  expect(fieldScope('top_k', status([['Mistral', 'mistral']]))).toBeUndefined();
  expect(
    fieldScope('seed', {
      ...status([['DeepSeek', 'deepseek']]),
      providers: status([['DeepSeek', 'deepseek']]).providers.map((provider) => ({
        ...provider,
        saved: false,
      })),
    }),
  ).toBeUndefined();
});
