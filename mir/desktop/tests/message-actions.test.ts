import { describe, expect, it } from 'vitest';
import { regenerationHistory, replaceMessage } from '../src/domain/messageActions';
import { newConversation, requestMessages } from '../src/domain/types';
import type { Conversation, Message } from '../src/domain/types';

function history(): Conversation {
  return {
    ...newConversation(),
    messages: ['First question', 'Partial answer', 'Later question', 'Later answer'].map(
      (content, index): Message => ({
        id: String(index),
        content,
        role: index % 2 ? 'assistant' : 'user',
        status: index === 1 ? 'stopped' : 'complete',
        reasoning: index % 2 ? 'Read-only reasoning' : '',
        metrics: index % 2 ? { outputTokens: 12 } : undefined,
      }),
    ),
  };
}

describe('linear message replacements', () => {
  it('edits an earlier user message without mutating the original partial response', () => {
    const original = history();
    const replacement = replaceMessage(original, '0', 'Revised question', 42);
    expect(replacement.messages.map((message) => message.content)).toEqual(['Revised question']);
    expect(replacement.updatedAt).toBe(42);
    expect(original.messages).toHaveLength(4);
    expect(original.messages[1].content).toBe('Partial answer');
  });
  it('retains preceding context and truncates after a regenerated user message', () => {
    expect(regenerationHistory(history(), '2').map((message) => message.content)).toEqual([
      'First question',
      'Partial answer',
      'Later question',
    ]);
    expect(regenerationHistory(history(), '0')).toHaveLength(1);
  });
  it('edits assistant Markdown while retaining reasoning and generated statistics', () => {
    const original = history();
    const replacement = replaceMessage(original, '1', '**Revised** answer', 42);
    expect(replacement.messages).toHaveLength(2);
    expect(replacement.messages[1]).toEqual({
      ...original.messages[1],
      content: '**Revised** answer',
    });
    expect(requestMessages(replacement.messages)[1]).toEqual({
      role: 'assistant',
      content: '**Revised** answer',
    });
  });
  it('rejects stale identifiers, empty edits, and streaming or failed response edits', () => {
    const original = history();
    expect(() => replaceMessage(original, 'missing', 'text', 42)).toThrow('no longer');
    expect(() => replaceMessage(original, '0', '  ', 42)).toThrow('empty');
    for (const status of ['streaming', 'error'] as const) {
      original.messages[1].status = status;
      expect(() => replaceMessage(original, '1', 'text', 42)).toThrow('cannot be edited');
    }
    expect(() => regenerationHistory(original, '1')).toThrow('user message');
  });
});
