import { describe, expect, it } from 'vitest';
import {
  normalizeComposerUrl,
  parseMarkdown,
  plainDocument,
  serializeMarkdown,
} from '../src/features/chat/composer/markdown';

describe('composer Markdown contract', () => {
  const examples = [
    'Plain text\nAnother line\n\nAnother paragraph',
    '**bold** and _italic_ and ~~struck~~',
    '**bold _and italic_** and ~~**both**~~',
    '**_~~all three~~_**',
    'snake_case_name and intraword*italic*word',
    '\\*literal\\* \\`code\\` \\~strike\\~ \\\\ \\_edge\\_',
    '\\- not a list\n1\\. not a list\n\\> not a quote\n\\# not a heading',
    '`code` and ``a`b``',
    '`` `code` ``',
    '- first\n  - child\n    1. numbered\n    2. second\n- last',
    '1. first\n   - child\n2. second',
    '9. nine\n10. ten\n    - child',
    '> first line\n> second **line**',
    'before\n\n> quote\n\nafter',
    '````\ncode\n```\nmore\n````',
    '[a (link)](https://example.com/a%28b%29)',
    '<https://example.com>',
  ];
  for (const markdown of examples) {
    it(`round trips ${JSON.stringify(markdown)}`, () => {
      expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
    });
  }
  it('escapes pasted text without applying Markdown', () => {
    expect(serializeMarkdown(plainDocument('*bold*\nsnake_case\n> quote\n1. list'))).toBe(
      '\\*bold\\*\nsnake_case\n\\> quote\n1\\. list',
    );
  });
  it('normalizes parentheses in link destinations', () => {
    expect(serializeMarkdown(parseMarkdown('[text](https://example.com/a(b))'))).toBe(
      '[text](https://example.com/a%28b%29)',
    );
  });
  it('keeps unsupported pasted block markers literal', () => {
    const text = '## Heading\n---\n===\na | b\n--|--';
    expect(serializeMarkdown(plainDocument(text))).toBe(
      '\\## Heading\n\\---\n\\===\na | b\n--\\|--',
    );
  });
  it('imports empty list items with a valid editable paragraph', () => {
    expect(parseMarkdown('-').content?.[0].content?.[0].content).toEqual([{ type: 'paragraph' }]);
    expect(serializeMarkdown(parseMarkdown('-'))).toBe('-');
  });
  it('preserves unsupported Markdown as literal text', () => {
    expect(serializeMarkdown(parseMarkdown('# Heading\n\n<script>alert(1)</script>'))).toBe(
      '\\# Heading\n\\<script>alert(1)\\</script>',
    );
  });
  it('keeps code delimiters literal and chooses a longer fence', () => {
    expect(
      serializeMarkdown({
        type: 'doc',
        content: [{ type: 'codeBlock', content: [{ type: 'text', text: '````\n*literal*' }] }],
      }),
    ).toBe('`````\n````\n*literal*\n`````');
  });
});

describe('composer link validation', () => {
  it.each([
    'javascript:alert(1)',
    'mailto:a@example.com',
    'a@example.com',
    'ftp://example.com',
    'file:///tmp/a',
    'https://a:b@example.com',
    'not a link',
    'localhost',
  ])('rejects %s', (url) => {
    expect(normalizeComposerUrl(url)).toBeNull();
  });
  it.each([
    ['example.com/a', 'https://example.com/a'],
    ['https://example.com', 'https://example.com'],
    ['http://localhost:1420/', 'http://localhost:1420/'],
  ])('accepts %s', (url, expected) => {
    expect(normalizeComposerUrl(url)).toBe(expected);
  });
});
