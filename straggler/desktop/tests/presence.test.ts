import { expect, test } from 'vitest';
import { assistantState } from '../src/domain/presence';

test('presence follows real server, stream, cancellation and error states', () => {
  const ready = {
    serverPhase: 'ready' as const,
    generating: false,
    generationPhase: 'waiting' as const,
    serverRunId: 'current',
    responseRunId: 'current',
  };
  expect(assistantState(ready)).toBe('ready');
  expect(assistantState({ ...ready, serverPhase: 'stopped' })).toBe('offline');
  expect(assistantState({ ...ready, serverPhase: 'stopping' })).toBe('offline');
  expect(assistantState({ ...ready, serverPhase: 'loading' })).toBe('loading');
  expect(assistantState({ ...ready, generating: true })).toBe('loading');
  expect(assistantState({ ...ready, generating: true, generationPhase: 'reasoning' })).toBe(
    'reasoning',
  );
  expect(assistantState({ ...ready, generating: true, generationPhase: 'generating' })).toBe(
    'generating',
  );
  expect(assistantState({ ...ready, responseStatus: 'stopped' })).toBe('stopped');
  expect(assistantState({ ...ready, responseStatus: 'interrupted' })).toBe('error');
  expect(assistantState({ ...ready, responseStatus: 'error' })).toBe('error');
  expect(
    assistantState({
      ...ready,
      serverPhase: 'needs-restart',
      generating: true,
      generationPhase: 'generating',
    }),
  ).toBe('error');
  expect(assistantState({ ...ready, serverPhase: 'error' })).toBe('error');
  expect(assistantState({ ...ready, responseStatus: 'length' })).toBe('ready');
  expect(assistantState({ ...ready, responseRunId: 'earlier', responseStatus: 'error' })).toBe(
    'ready',
  );
  expect(assistantState({ ...ready, responseRunId: undefined, responseStatus: 'stopped' })).toBe(
    'ready',
  );
});
