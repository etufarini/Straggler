import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo } from 'react';
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

export default memo(function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={plugins} components={components}>
      {children}
    </ReactMarkdown>
  );
});
