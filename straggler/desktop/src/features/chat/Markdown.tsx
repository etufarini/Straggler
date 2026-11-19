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
const plugins = [remarkGfm];
const userPlugins = [remarkGfm, remarkBreaks];
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
  onProjectSource,
  user = false,
}: {
  children: string;
  sources?: WebSource[];
  projectSources?: ProjectPassage[];
  onProjectSource?: (source: ProjectPassage) => void;
  user?: boolean;
}) {
  const sourcePlugins = useMemo(
    () =>
      sources.length || projectSources.length
        ? [...plugins, citationPlugin(sources, projectSources)]
        : plugins,
    [sources, projectSources],
  );
  const sourceComponents = useMemo<Components>(
    () =>
      sources.length || projectSources.length
        ? {
            ...components,
            a: ({ children, href }) => {
              const projectMatch = /^#straggler-source-P(\d+)$/.exec(href ?? '');
              const passage =
                projectMatch &&
                projectSources.find((source) => source.n === Number(projectMatch[1]));
              if (passage && onProjectSource) {
                return (
                  <button
                    type="button"
                    className="web-citation"
                    aria-label={`Project source ${passage.n}: ${passage.name} · section ${passage.section}`}
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
    [sources, projectSources, onProjectSource],
  );
  return (
    <ReactMarkdown
      remarkPlugins={user ? userPlugins : sourcePlugins}
      components={user ? userComponents : sourceComponents}
    >
      {children}
    </ReactMarkdown>
  );
});
