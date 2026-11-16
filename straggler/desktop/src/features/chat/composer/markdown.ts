import type { JSONContent } from '@tiptap/core';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, PhrasingContent } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);
type Mark = NonNullable<JSONContent['marks']>[number];
const alphanumeric = (text: string) => /[\p{L}\p{N}]/u.test(text);

export function normalizeComposerUrl(value: string): string | null {
  const input = value.trim();
  if (!input || /\s/.test(input) || (!/^https?:\/\//i.test(input) && input.includes('@')))
    return null;
  const candidate = /^[a-z][\w+.-]*:/i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (!/^https?:\/\//i.test(input) && !url.hostname.includes('.')) return null;
    return candidate;
  } catch {
    return null;
  }
}

export function plainDocument(text: string): JSONContent {
  return {
    type: 'doc',
    content: text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
  };
}

/** Parse standard Markdown only. Slack's single-star bold belongs to typing rules. */
export function parseMarkdown(markdown: string): JSONContent {
  const source = markdown.replace(/\r\n?/g, '\n');
  function literal(node: RootContent | PhrasingContent): string {
    return source.slice(node.position?.start.offset, node.position?.end.offset);
  }
  function inline(nodes: PhrasingContent[], marks: Mark[] = []): JSONContent[] {
    return nodes.flatMap((node): JSONContent[] => {
      switch (node.type) {
        case 'text':
          return node.value
            .split('\n')
            .flatMap((text, index) => [
              ...(index ? [{ type: 'hardBreak' }] : []),
              ...(text ? [{ type: 'text', text, marks }] : []),
            ]);
        case 'break':
          return [{ type: 'hardBreak' }];
        case 'strong':
        case 'emphasis':
        case 'delete':
          return inline(node.children, [
            ...marks,
            {
              type: { strong: 'bold', emphasis: 'italic', delete: 'strike' }[node.type],
            },
          ]);
        case 'inlineCode':
          return [{ type: 'text', text: node.value, marks: [{ type: 'code' }] }];
        case 'link': {
          const href = normalizeComposerUrl(node.url);
          return href
            ? inline(node.children, [...marks, { type: 'link', attrs: { href } }])
            : [{ type: 'text', text: literal(node), marks }];
        }
        default:
          // Unsupported Markdown stays visible as literal text, never executable HTML.
          return [{ type: 'text', text: literal(node), marks }];
      }
    });
  }
  function blocks(nodes: RootContent[]): JSONContent[] {
    return nodes.flatMap((node, index): JSONContent[] => {
      const previous = nodes[index - 1];
      const blanks =
        node.type === 'paragraph' && previous?.type === 'paragraph'
          ? Array.from(
              {
                length: Math.max(
                  1,
                  (node.position?.start.line ?? 0) - (previous.position?.end.line ?? 0) - 1,
                ),
              },
              () => ({ type: 'paragraph' }),
            )
          : [];
      switch (node.type) {
        case 'paragraph':
          return [...blanks, { type: 'paragraph', content: inline(node.children) }];
        case 'blockquote':
          return [{ type: 'blockquote', content: blocks(node.children) }];
        case 'code':
          return [
            { type: 'codeBlock', content: node.value ? [{ type: 'text', text: node.value }] : [] },
          ];
        case 'list':
          return [
            {
              type: node.ordered ? 'orderedList' : 'bulletList',
              ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
              content: node.children.map((item) => ({
                type: 'listItem',
                content: blocks(item.children),
              })),
            },
          ];
        default:
          return plainDocument(literal(node)).content ?? [];
      }
    });
  }
  const content = blocks(parser.parse(source).children);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function escapeText(text: string, before = '', after = ''): string {
  return text
    .replace(/[\\`*~]/g, '\\$&')
    .replace(/_/g, (match, index, value: string) =>
      alphanumeric(value[index - 1] ?? before) && alphanumeric(value[index + 1] ?? after)
        ? match
        : '\\_',
    )
    .replace(/\[(?=[^\]]*\]\()/g, '\\[')
    .replace(/<(?=[!/?\w])/g, '\\<')
    .replace(/&(?=#?\w+;)/g, '\\&');
}

function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3');
}

function wrapMark(marker: string, text: string): string {
  if (!text.trim()) return text;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  return (
    leading + marker + text.slice(leading.length, text.length - trailing.length) + marker + trailing
  );
}

function codeSpan(text: string): string {
  const ticks = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const padding = /^`|`$/.test(text) || /^ .* $/.test(text) ? ' ' : '';
  return ticks + padding + text + padding + ticks;
}

function inlineMarkdown(nodes: JSONContent[], escape: boolean): string {
  const ordered = nodes.map((node) => ({
    ...node,
    marks: node.marks ?? [],
  }));
  function render(start: number, end: number, depth: number): string {
    let output = '';
    for (let index = start; index < end;) {
      const node = ordered[index];
      const mark = node.marks[depth];
      const before = ordered[index - 1]?.text?.slice(-1) ?? '';
      if (!mark) {
        const after = ordered[index + 1]?.text?.charAt(0) ?? '';
        output +=
          node.type === 'hardBreak'
            ? '\n'
            : escape
              ? escapeText(node.text ?? '', before, after)
              : (node.text ?? '');
        index++;
        continue;
      }
      let next = index + 1;
      while (next < end && JSON.stringify(ordered[next].marks[depth]) === JSON.stringify(mark))
        next++;
      const inner = render(index, next, depth + 1);
      const raw = ordered
        .slice(index, next)
        .map((node) => node.text ?? '\n')
        .join('');
      switch (mark.type) {
        case 'bold':
          output += wrapMark('**', inner);
          break;
        case 'italic': {
          const after = ordered[next]?.text?.charAt(0) ?? '';
          output += wrapMark(alphanumeric(before) || alphanumeric(after) ? '*' : '_', inner);
          break;
        }
        case 'strike':
          output += wrapMark('~~', inner);
          break;
        case 'code':
          output += codeSpan(raw);
          break;
        case 'link': {
          const href = normalizeComposerUrl(String(mark.attrs?.href ?? ''));
          const url = href?.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
          output += !url ? inner : raw === href ? `<${href}>` : `[${inner}](${url})`;
          break;
        }
        default:
          output += inner;
      }
      index = next;
    }
    return output;
  }
  return render(0, ordered.length, 0);
}

/** Serialize the supported document using the prototype's compact CommonMark contract. */
export function serializeMarkdown(document: JSONContent, escape = true): string {
  function list(node: JSONContent, indent = ''): string {
    let number = Number(node.attrs?.start ?? 1);
    return (node.content ?? [])
      .flatMap((item) => {
        const marker = node.type === 'orderedList' ? `${number++}. ` : '- ';
        const continuation = indent + ' '.repeat(marker.length);
        const children = item.content ?? [];
        const text = children
          .filter((child) => !['orderedList', 'bulletList'].includes(child.type ?? ''))
          .map((child) => inlineMarkdown(child.content ?? [], escape))
          .join('\n')
          .replace(/\n+$/, '');
        const lines = text.split('\n');
        return [
          indent + marker + lines[0],
          ...lines.slice(1).map((line) => continuation + line),
          ...children
            .filter((child) => ['orderedList', 'bulletList'].includes(child.type ?? ''))
            .map((child) => list(child, continuation)),
        ];
      })
      .join('\n');
  }
  function blocks(nodes: JSONContent[]): string {
    return nodes
      .map((node, index) => {
        const separator =
          index === 0
            ? ''
            : node.type === 'paragraph' && nodes[index - 1].type === 'paragraph'
              ? '\n'
              : '\n\n';
        let text: string;
        switch (node.type) {
          case 'orderedList':
          case 'bulletList':
            text = list(node);
            break;
          case 'blockquote':
            text = blocks(node.content ?? [])
              .split('\n')
              .map((line) => (line ? `> ${line}` : '>'))
              .join('\n');
            break;
          case 'codeBlock': {
            const code = (node.content ?? []).map((child) => child.text ?? '').join('');
            const fence = '`'.repeat(
              Math.max(2, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length)) + 1,
            );
            text = `${fence}\n${code}\n${fence}`;
            break;
          }
          default:
            text = inlineMarkdown(node.content ?? [], escape);
            if (escape) text = text.split('\n').map(escapeLineStart).join('\n');
        }
        return separator + text;
      })
      .join('');
  }
  return blocks(document.content ?? [])
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '');
}
