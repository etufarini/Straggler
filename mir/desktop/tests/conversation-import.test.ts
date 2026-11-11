import { describe, expect, it } from 'vitest';
import { materializeImport } from '../src/domain/conversationImport';
import type { ImportedConversation } from '../src/domain/conversationImport';

const imported: ImportedConversation = {
  title: 'From a file',
  createdAt: '2026-11-10T00:00:00Z',
  model: 'example.gguf',
  systemPrompt: 'Instructions',
  messages: [
    { role: 'user', content: 'First question', reasoning: '', model: null },
    { role: 'assistant', content: '**Answer**', reasoning: 'Reasoning', model: 'earlier.gguf' },
  ],
};

describe('materializing validated native imports', () => {
  it('always allocates fresh identities while preserving exported context', () => {
    const first = materializeImport(imported, 42);
    const second = materializeImport(imported, 43);
    expect(first.id).not.toBe(second.id);
    expect(first.messages[0].id).not.toBe(second.messages[0].id);
    expect(first.createdAt).toBe(Date.parse(imported.createdAt!));
    expect(first.updatedAt).toBe(42);
    expect(first.options?.systemPrompt).toBe('Instructions');
    expect(first.messages[1]).toMatchObject({
      content: '**Answer**',
      reasoning: 'Reasoning',
      model: 'earlier.gguf',
      status: 'complete',
    });
  });
  it('derives a title from the first user message and keeps absent system instructions empty', () => {
    const value = materializeImport(
      { ...imported, title: null, createdAt: null, systemPrompt: null },
      42,
    );
    expect(value.title).toBe('First question');
    expect(value.createdAt).toBe(42);
    expect(value.options?.systemPrompt).toBe('');
  });
});

it('derives a Unicode title without splitting an emoji before native storage', () => {
  const content = 'a' + '😀'.repeat(80);
  const chat = materializeImport(
    { ...imported, title: null, messages: [{ role: 'user', content, reasoning: '', model: null }] },
    42,
  );
  expect(chat.title).toBe('a' + '😀'.repeat(79));
});
