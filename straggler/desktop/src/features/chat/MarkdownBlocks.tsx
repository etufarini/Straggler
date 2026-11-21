import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Copy, Check, TriangleAlert } from 'lucide-react';
import type { Element, RootContent } from 'hast';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';

const highlighter = createLowlight({
  javascript,
  typescript,
  python,
  rust,
  bash,
  json,
  css,
  xml,
  sql,
});
highlighter.registerAlias({
  javascript: ['js', 'jsx'],
  typescript: ['ts', 'tsx'],
  python: ['py'],
  rust: ['rs'],
  bash: ['sh', 'shell'],
  xml: ['html'],
});

export function CopyContent({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <span className="markdown-copy">
      <button
        type="button"
        className="message-action"
        aria-label={label}
        title={copied ? 'Copied' : label}
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <span role={error ? 'alert' : 'status'} className={error ? 'field-error' : 'visually-hidden'}>
        {error ? 'Couldn’t copy the text. Try again.' : copied ? 'Copied' : ''}
      </span>
    </span>
  );
}

export function nodeText(node: RootContent): string {
  return node.type === 'text'
    ? node.value
    : 'children' in node
      ? node.children.map(nodeText).join('')
      : '';
}

function highlightNodes(nodes: RootContent[]): ReactNode {
  return nodes.map((node, index) =>
    node.type === 'text' ? (
      node.value
    ) : node.type === 'element' ? (
      <span
        key={index}
        className={
          Array.isArray(node.properties.className) ? node.properties.className.join(' ') : undefined
        }
      >
        {highlightNodes(node.children)}
      </span>
    ) : null,
  );
}

export function CodeBlock({ node, children }: { node?: Element; children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const source = code ? nodeText(code).replace(/\n$/, '') : '';
  const classes = code?.type === 'element' ? code.properties.className : null;
  const language =
    code?.type === 'element' && code.properties.dataCodeLanguage
      ? String(code.properties.dataCodeLanguage)
      : Array.isArray(classes)
        ? String(classes.find((name) => String(name).startsWith('language-')) ?? '').slice(9)
        : '';
  const highlighted = useMemo(
    () =>
      language && highlighter.registered(language)
        ? highlightNodes(highlighter.highlight(language, source).children)
        : source,
    [language, source],
  );
  if (!code) return <pre>{children}</pre>;
  const long = source.split('\n').length > 24;
  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language}</span>
        <CopyContent text={source} label="Copy code" />
      </div>
      <pre className={long && !expanded ? 'code-collapsed' : undefined}>
        <code>{highlighted}</code>
      </pre>
      {long && (
        <button
          type="button"
          className="text-button code-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function hasMathError(node: RootContent): boolean {
  return (
    node.type === 'element' &&
    ((Array.isArray(node.properties.className) &&
      node.properties.className.includes('katex-error')) ||
      node.children.some(hasMathError))
  );
}

export function MathFormula({ node, children }: { node: Element; children: ReactNode }) {
  const source = String(node.properties.dataMathSource ?? '');
  const display =
    node.properties.dataMathDisplay === true || node.properties.dataMathDisplay === 'true';
  const pending =
    Array.isArray(node.properties.className) && node.properties.className.includes('math-pending');
  const invalid = hasMathError(node);
  return (
    <span
      className={`${display ? 'math-block' : 'math-inline-formula'}${pending ? ' math-pending' : ''}${invalid ? ' math-invalid' : ''}`}
    >
      <span className="math-content">{children}</span>
      {display && !pending && <CopyContent text={source} label="Copy LaTeX" />}
      {display && invalid && (
        <span className="math-error-note" role="status">
          <TriangleAlert size={12} />
          Couldn’t render this formula · showing the source
        </span>
      )}
    </span>
  );
}
