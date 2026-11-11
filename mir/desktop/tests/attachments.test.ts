import { describe, expect, it } from 'vitest';
import {
  approximateTokens,
  attachmentBlocks,
  composeRequest,
  sortAttachmentRows,
} from '../src/domain/attachments';
import type { AttachmentRow } from '../src/domain/attachments';
import type { Attachment, Message } from '../src/domain/types';

const files: Attachment[] = [
  { id: 'md', name: 'b.md', extension: 'md', size: 12, text: 'Markdown text' },
  { id: 'txt', name: 'a.txt', extension: 'txt', size: 12, text: 'Plain text' },
];

describe('conversation attachments', () => {
  it('sorts the view by type then locale-aware name, with failed files last, preserving insertion order', () => {
    const rows: AttachmentRow[] = [
      { id: 'failed', name: 'a.txt', extension: 'txt', size: null, state: 'error' },
      ...files.map((attachment): AttachmentRow => ({ ...attachment, state: 'ready' })),
      { id: 'other', name: 'c.txt', extension: 'txt', size: 1, state: 'reading' },
    ];
    expect(sortAttachmentRows(rows).map((row) => row.id)).toEqual(['txt', 'other', 'md', 'failed']);
    expect(rows[0].id).toBe('failed');
    expect(files.map((file) => file.id)).toEqual(['md', 'txt']);
  });
  it('delimits attachment text by file name in deterministic insertion order on every request', () => {
    const messages: Message[] = [
      { id: 'question', role: 'user', content: 'Question', reasoning: '', status: 'complete' },
    ];
    const first = composeRequest(messages, 'Instructions', files);
    expect(first[0]).toEqual({ role: 'system', content: 'Instructions' });
    expect(first[1].content).toBe(attachmentBlocks(files) + '\n\nQuestion');
    expect(first[1].content.indexOf('b.md')).toBeLessThan(first[1].content.indexOf('a.txt'));
    expect(composeRequest(messages, 'Instructions', files)).toEqual(first);
    expect(messages[0].content).toBe('Question');
  });
  it('keeps exported chat text independent of attachment blocks and excludes reasoning from requests', () => {
    const messages: Message[] = [
      { id: 'question', role: 'user', content: 'Question', reasoning: '', status: 'complete' },
      {
        id: 'answer',
        role: 'assistant',
        content: 'Answer',
        reasoning: 'Private',
        status: 'stopped',
      },
    ];
    expect(JSON.stringify(composeRequest(messages, '', files))).not.toContain('Private');
    expect(composeRequest(messages, '', [])[0].content).toBe('Question');
  });
  it('uses UTF-8 bytes for the explicitly approximate local estimate', () => {
    expect(approximateTokens('caffè ☕')).toBe(
      Math.ceil(new TextEncoder().encode('caffè ☕').length / 4),
    );
    expect(approximateTokens('')).toBe(0);
  });
});
