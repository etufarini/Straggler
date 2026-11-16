import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { memo, useMemo } from 'react';
import { citationPlugin } from '../../domain/citations';
import type { WebSource } from '../../domain/webSearch';
import WebLink from '../websearch/WebLink';
import type { Components } from 'react-markdown';

// Component identities stay stable during status polling and streamed updates.
// Generated content stays inside the app without remote loads or navigation.
const components: Components = {
  a: ({ children, href }) => (
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

export default memo(function Markdown({
  children,
  sources = emptySources,
  user = false,
}: {
  children: string;
  sources?: WebSource[];
  user?: boolean;
}) {
  const sourcePlugins = useMemo(
    () => (sources.length ? [...plugins, citationPlugin(sources)] : plugins),
    [sources],
  );
  const sourceComponents = useMemo<Components>(
    () =>
      sources.length
        ? {
            ...components,
            a: ({ children, href }) => {
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
              ) : (
                <span className="message-link" title={href}>
                  {children}
                </span>
              );
            },
          }
        : components,
    [sources],
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
