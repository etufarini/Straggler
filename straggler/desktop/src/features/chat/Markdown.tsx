import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  remarkLatexDelimiters,
  rehypeLiteralMathCode,
  rehypeMathErrors,
} from '../../domain/markdownMath';
import { CodeBlock, MathFormula } from './MarkdownBlocks';
import 'katex/dist/katex.min.css';
import type { PluggableList } from 'unified';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo, useMemo } from 'react';
import { citationPlugin } from '../../domain/citations';
import type { ProjectPassage } from '../../domain/types';
import type { WebSource } from '../../domain/webSearch';
import WebLink from '../websearch/WebLink';
import type { Components } from 'react-markdown';

// Component identities stay stable during status polling and streamed updates.
// Generated content stays inside the app without remote loads or navigation.
const components: Components = {
  pre: CodeBlock,
  span: ({ node, children, ...props }) =>
    node?.properties.dataMathSource !== undefined ? (
      <MathFormula node={node}>{children}</MathFormula>
    ) : (
      <span {...props}>{children}</span>
    ),
  a: ({ children, href }) =>
    /^mailto:/i.test(href ?? '') ? (
      <WebLink url={href!}>{children}</WebLink>
    ) : (
      <span className="message-link" title={href}>
        {children}
      </span>
    ),
  img: ({ alt }) => <span className="image-placeholder">[Image: {alt || 'not loaded'}]</span>,
};
const plugins: PluggableList = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  remarkLatexDelimiters,
];
const mathPlugins: PluggableList = [
  rehypeLiteralMathCode,
  [rehypeKatex, { trust: false, output: 'htmlAndMathml', errorColor: 'currentColor' }],
  rehypeMathErrors,
];
const userPlugins = [...plugins, remarkBreaks];
const userComponents: Components = {
  ...components,
  a: ({ children, href }) =>
    href ? <WebLink url={href}>{children}</WebLink> : <span>{children}</span>,
};
const emptySources: WebSource[] = [];
const emptyProjectSources: ProjectPassage[] = [];

export default memo(function Markdown({
  children,
  sources = emptySources,
  projectSources = emptyProjectSources,
  attachmentSources = emptyProjectSources,
  onProjectSource,
  user = false,
}: {
  children: string;
  sources?: WebSource[];
  projectSources?: ProjectPassage[];
  attachmentSources?: ProjectPassage[];
  onProjectSource?: (source: ProjectPassage) => void;
  user?: boolean;
}) {
  const sourcePlugins = useMemo(
    () =>
      sources.length || projectSources.length || attachmentSources.length
        ? [...plugins, citationPlugin(sources, projectSources, attachmentSources)]
        : plugins,
    [sources, projectSources, attachmentSources],
  );
  const sourceComponents = useMemo<Components>(
    () =>
      sources.length || projectSources.length || attachmentSources.length
        ? {
            ...components,
            a: ({ children, href }) => {
              const projectMatch = /^#straggler-source-([PA])(\d+)$/.exec(href ?? '');
              const passage =
                projectMatch &&
                (projectMatch[1] === 'P' ? projectSources : attachmentSources).find(
                  (source) => source.n === Number(projectMatch[2]),
                );
              if (passage && onProjectSource) {
                return (
                  <button
                    type="button"
                    className="web-citation"
                    aria-label={`${passage.projectId ? 'Project' : 'Attachment'} source ${passage.n}: ${passage.name} · section ${passage.section}`}
                    onClick={() => onProjectSource(passage)}
                  >
                    {children}
                  </button>
                );
              }
              const match = /^#straggler-source-(\d+)$/.exec(href ?? '');
              const source = match && sources.find((source) => source.n === Number(match[1]));
              return source ? (
                <WebLink
                  url={source.url}
                  className="web-citation"
                  label={`Source ${source.n}: ${source.title}`}
                  title={`${source.title} · ${source.domain}`}
                >
                  {children}
                </WebLink>
              ) : /^mailto:/i.test(href ?? '') ? (
                <WebLink url={href!}>{children}</WebLink>
              ) : (
                <span className="message-link" title={href}>
                  {children}
                </span>
              );
            },
          }
        : components,
    [sources, projectSources, attachmentSources, onProjectSource],
  );
  return (
    <ReactMarkdown
      remarkPlugins={user ? userPlugins : sourcePlugins}
      rehypePlugins={mathPlugins}
      components={user ? userComponents : sourceComponents}
    >
      {children}
    </ReactMarkdown>
  );
});
