import { describe, expect, test } from 'vitest';
import { citationPlugin } from '../src/domain/citations';
import { sourceUrl } from '../src/domain/webSearch';
import type { WebSource } from '../src/domain/webSearch';

const sources: WebSource[] = [
  { n: 1, title: 'One', url: 'https://example.org/a', domain: 'example.org' },
];
describe('source rendering boundary', () => {
  test('unknown citation numbers stay text, including code and existing links', () => {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'A [1] B [99] C' },
            { type: 'inlineCode', value: '[1]' },
            {
              type: 'link',
              url: 'https://example.com',
              children: [{ type: 'text', value: '[1]' }],
            },
          ],
        },
      ],
    };
    citationPlugin(sources)()(tree);
    expect(tree.children[0].children).toEqual([
      { type: 'text', value: 'A ' },
      { type: 'link', url: '#straggler-source-1', children: [{ type: 'text', value: '1' }] },
      { type: 'text', value: ' B [99] C' },
      { type: 'inlineCode', value: '[1]' },
      { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: '[1]' }] },
    ]);
  });
  test('external links accept web URLs without credentials', () => {
    expect(sourceUrl('https://example.org/a')).toBe('https://example.org/a');
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,test',
      'https://user:secret@example.org',
    ])
      expect(sourceUrl(url)).toBeNull();
  });
});
