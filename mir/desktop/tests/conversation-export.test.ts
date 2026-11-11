import { describe, expect, it } from 'vitest';
import { exportFileName, serializeConversation } from '../src/domain/conversationExport';
import { newConversation } from '../src/domain/types';
import { defaultSettings } from '../src/services/fixtures';

function conversation() {
  return {
    ...newConversation(),
    title: 'A local chat',
    createdAt: 1,
    model: '/example/model.gguf',
    messages: [
      {
        id: 'user',
        role: 'user' as const,
        content: 'Question ☕',
        reasoning: '',
        status: 'complete' as const,
      },
      {
        id: 'response',
        role: 'assistant' as const,
        content: '**Partial** answer',
        reasoning: 'Private reasoning',
        status: 'stopped' as const,
        metrics: { outputTokens: 12 },
      },
    ],
  };
}

describe('Mir conversation export version 1', () => {
  it('exports only the defined public fields without private reasoning or request options', () => {
    const chat = conversation();
    const result = JSON.parse(serializeConversation(chat, false, '2026-11-11T00:00:00Z'));
    expect(result).toEqual({
      format: 'mir.cpp/conversation',
      version: 1,
      exportedAt: '2026-11-11T00:00:00Z',
      includesReasoning: false,
      conversation: {
        title: chat.title,
        createdAt: '1970-01-01T00:00:00.001Z',
        model: chat.model,
        messages: [
          { role: 'user', content: 'Question ☕' },
          { role: 'assistant', content: '**Partial** answer', model: chat.model },
        ],
      },
    });
    expect(chat.messages[1].reasoning).toBe('Private reasoning');
  });
  it('includes reasoning only on assistant messages and only when requested', () => {
    const result = JSON.parse(serializeConversation(conversation(), true, 'now'));
    expect(result.includesReasoning).toBe(true);
    expect(result.conversation.messages[1].reasoning_content).toBe('Private reasoning');
    expect(result.conversation.messages[0].reasoning_content).toBeUndefined();
  });
  it('includes an effective system prompt, respecting explicit empty overrides', () => {
    const chat = conversation();
    const settings = { ...defaultSettings, chat_system_prompt: 'Default instructions' };
    expect(
      JSON.parse(serializeConversation(chat, false, 'now', settings)).conversation.messages[0],
    ).toEqual({ role: 'system', content: 'Default instructions' });
    chat.options = { systemPrompt: '', reasoning: 'off', effort: 'auto' };
    expect(
      JSON.parse(serializeConversation(chat, false, 'now', settings)).conversation.messages[0].role,
    ).toBe('user');
  });
  it('sanitizes filenames without losing Unicode or creating paths', () => {
    expect(exportFileName('../A/B\\C: café?')).toBe('A B C  café.json');
    expect(exportFileName('...')).toBe('conversation.json');
    expect(exportFileName('Saved.json')).toBe('Saved.json');
    expect(exportFileName('☕'.repeat(200))).toBe('☕'.repeat(120) + '.json');
  });
});
