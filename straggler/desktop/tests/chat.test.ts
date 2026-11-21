import { expect, test } from 'vitest';
import { currentContext, resolveChatOptions } from '../src/domain/chat';
import { sameServerConfiguration, equalSettings, generationKeys } from '../src/domain/types';
import type { Message, ServerDetails, ServerStatus } from '../src/domain/types';
import { defaultSettings } from '../src/services/fixtures';

test('request defaults and overrides are independent of server restart comparisons', () => {
  const settings = {
    ...defaultSettings,
    chat_system_prompt: 'Default instructions',
    chat_reasoning: 'on' as const,
    chat_reasoning_effort: 'xhigh',
  };
  expect(resolveChatOptions(undefined, settings)).toEqual({
    systemPrompt: 'Default instructions',
    reasoning: 'on',
    effort: 'xhigh',
  });
  expect(
    resolveChatOptions({ systemPrompt: '', reasoning: 'off', effort: null }, settings),
  ).toEqual({ systemPrompt: '', reasoning: 'off', effort: 'xhigh' });
  expect(resolveChatOptions(undefined, settings, true)).toEqual({
    systemPrompt: 'Default instructions',
    reasoning: 'on',
    effort: 'auto',
  });
  expect(equalSettings(defaultSettings, settings)).toBe(false);
  expect(sameServerConfiguration(defaultSettings, settings)).toBe(true);
  for (const key of generationKeys) {
    const changed = { ...settings, [key]: '1' };
    expect(sameServerConfiguration(settings, changed)).toBe(true);
    expect(equalSettings(settings, changed)).toBe(false);
  }
  expect(sameServerConfiguration(defaultSettings, { ...settings, context: '8192' })).toBe(false);
});

test('context uses the running capacity, rejects other server runs and keeps unavailable data unknown', () => {
  const details: ServerDetails = {
    runId: 'current',
    contextSize: 100,
    reasoningSupported: null,
    effortLevels: [],
    systemRoleSupported: null,
    error: null,
  };
  const server = { phase: 'ready', runId: 'current' } as ServerStatus;
  const message = {
    role: 'assistant',
    metrics: { runId: 'current', contextTokens: 74, contextSource: 'usage' },
  } as Message;
  expect(currentContext([message], details, server)?.level).toBe('normal');
  expect(
    currentContext(
      [{ ...message, metrics: { ...message.metrics, contextTokens: 75 } }],
      details,
      server,
    )?.level,
  ).toBe('high');
  expect(
    currentContext(
      [{ ...message, metrics: { ...message.metrics, contextTokens: 90 } }],
      details,
      server,
    )?.level,
  ).toBe('full');
  expect(
    currentContext(
      [{ ...message, metrics: { ...message.metrics, contextTokens: 120 } }],
      details,
      server,
    )?.percent,
  ).toBe(120);
  expect(currentContext([message], { ...details, runId: 'old' }, server)).toBeNull();
  expect(
    currentContext([{ ...message, metrics: { runId: 'old', contextTokens: 74 } }], details, server),
  ).toBeNull();
  expect(currentContext([message], { ...details, contextSize: null }, server)).toBeNull();
  expect(currentContext([], details, server)).toBeNull();
});
