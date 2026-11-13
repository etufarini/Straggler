import { describe, expect, it } from 'vitest';
import { requestMessages } from '../src/domain/types';
import type { Message } from '../src/domain/types';

describe('conversation context', () => {
  it('sends plain text without failed placeholders or private reasoning', () => {
    const message = (
      role: Message['role'],
      content: string,
      status: Message['status'],
    ): Message => ({
      id: crypto.randomUUID(),
      role,
      content,
      status,
      reasoning: 'Internal model reasoning',
    });
    expect(
      requestMessages([
        message('user', 'Explain it', 'complete'),
        message('assistant', '', 'error'),
        message('assistant', 'Unfinished failure', 'error'),
        message('user', 'Try again', 'complete'),
        message('assistant', 'A stopped but useful answer', 'stopped'),
      ]),
    ).toEqual([
      { role: 'user', content: 'Explain it\n\nTry again' },
      { role: 'assistant', content: 'A stopped but useful answer' },
    ]);
  });
});
