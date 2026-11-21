import type {} from 'micromark-extension-math';
import type { Root, RootContent } from 'mdast';
import type { Processor } from 'unified';
import type { Tokenizer, State } from 'micromark-util-types';

// This extension runs only in Markdown text. Code spans and fences never enter it.
// Tokenizing before Markdown escapes preserves LaTeX backslashes and underscores.
const tokenizeLatex: Tokenizer = function (effects, ok, nok) {
  let closing = 0;
  let dataOpen = false;
  const close: Tokenizer = (effects, ok, nok) => {
    effects.enter('mathTextSequence');
    return (code) => {
      if (code !== 92) return nok(code);
      effects.consume(code);
      return (code) => {
        if (code !== closing) return nok(code);
        effects.consume(code);
        effects.exit('mathTextSequence');
        return ok;
      };
    };
  };
  const finish: State = (code) => {
    if (dataOpen) effects.exit('mathTextData');
    return effects.attempt(
      { tokenize: close },
      (code) => {
        effects.exit('mathText');
        return ok(code);
      },
      nok,
    )(code);
  };
  const data: State = (code) => {
    if (code === null) return nok(code);
    if (code >= -5 && code <= -3) {
      if (dataOpen) effects.exit('mathTextData');
      dataOpen = false;
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      return data;
    }
    if (code === 92) return effects.check({ tokenize: close }, finish, consume)(code);
    return consume(code);
  };
  const consume: State = (code) => {
    if (!dataOpen) {
      effects.enter('mathTextData');
      dataOpen = true;
    }
    effects.consume(code);
    return data;
  };
  return (code) => {
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    effects.consume(code);
    return (code) => {
      if (code !== 40 && code !== 91) return nok(code);
      closing = code === 40 ? 41 : 93;
      effects.consume(code);
      effects.exit('mathTextSequence');
      return data;
    };
  };
};

export function remarkLatexDelimiters(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { 92: { name: 'latexDelimiters', tokenize: tokenizeLatex } },
  });
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    function visit(node: Root | RootContent) {
      if (node.type === 'math' || node.type === 'inlineMath') {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        const display = node.type === 'math' || raw.startsWith('\\[') || raw.startsWith('$$');
        const closed = raw.startsWith('\\')
          ? raw.endsWith(raw.startsWith('\\[') ? '\\]' : '\\)')
          : node.type !== 'math' || /\n\s*\${2,}\s*$/.test(raw);
        // Keep a stable source wrapper around KaTeX's replacement nodes for copy and errors.
        node.data = {
          hName: 'span',
          hProperties: {
            dataMathSource: node.value,
            dataMathDisplay: display,
            className: [closed ? 'math-formula' : 'math-pending'],
          },
          hChildren: closed
            ? [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: [display ? 'math-display' : 'math-inline'] },
                  children: [{ type: 'text', value: node.value }],
                },
              ]
            : [{ type: 'text', value: raw }],
        };
        return;
      }
      if (node.type === 'code' || node.type === 'inlineCode') return;
      if (node.type === 'text') {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
        if (/(?<!\\)(?:\\\(|\\\[|\$\$)/.test(raw)) {
          node.data = { hName: 'span', hProperties: { className: ['math-pending'] } };
          // Markdown's character escape would otherwise hide the opening delimiter.
          node.value = raw;
        }
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function rehypeLiteralMathCode() {
  return (tree: import('hast').Root) => {
    function visit(node: import('hast').Root | import('hast').RootContent) {
      if (
        node.type === 'element' &&
        node.tagName === 'code' &&
        Array.isArray(node.properties.className)
      ) {
        // A fenced block labelled math is still code, not a formula delimiter.
        if (node.properties.className.includes('language-math'))
          node.properties.dataCodeLanguage = 'math';
        node.properties.className = node.properties.className.filter(
          (name) => name !== 'language-math',
        );
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}

export function rehypeMathErrors() {
  return (
    tree: import('hast').Root,
    file: {
      messages: { source?: string | null; ancestors?: readonly unknown[]; message: string }[];
    },
  ) => {
    const errors = file.messages.filter((message) => message.source === 'rehype-katex');
    function visit(node: import('hast').Root | import('hast').RootContent) {
      if (node.type === 'element' && node.properties.dataMathSource !== undefined) {
        const error = errors.find((message) => message.ancestors?.includes(node));
        if (error)
          node.children = [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['katex-error'], title: error.message },
              children: [{ type: 'text', value: String(node.properties.dataMathSource) }],
            },
          ];
        return;
      }
      if ('children' in node) node.children.forEach(visit);
    }
    visit(tree);
  };
}
