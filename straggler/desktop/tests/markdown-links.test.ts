import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import Markdown from '../src/features/chat/Markdown';

vi.mock('../src/services/desktop', () => ({ openWebUrl: vi.fn() }));

const source = { n: 1, title: 'One', url: 'https://example.org/a', domain: 'example.org' };

test('assistant links keep the same policy with and without sources', () => {
  const children =
    '[Site](https://example.org/page) [Email](mailto:person@example.org?subject=Hello&bcc=hidden@example.org)';
  const plain = renderToStaticMarkup(createElement(Markdown, { children }));
  const cited = renderToStaticMarkup(createElement(Markdown, { children, sources: [source] }));

  expect(cited).toBe(plain);
  expect(plain).toContain(
    '<span class="message-link" title="https://example.org/page">Site</span>',
  );
  expect(plain).toContain(
    '<a href="mailto:person@example.org" rel="noreferrer noopener">Email</a>',
  );
  expect(plain).not.toContain('hidden@example.org');
  expect(plain).not.toContain('subject=');
});

test('known citations open their source while unknown citations stay literal', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { children: 'Known [1], unknown [99].', sources: [source] }),
  );

  expect(html).toContain('href="https://example.org/a" class="web-citation"');
  expect(html).toContain('aria-label="Source 1: One"');
  expect(html).toContain('unknown [99].');
});
