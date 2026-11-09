import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Keep generated content inside the app; no remote image loads or navigation.
        a: ({ children, href }) => (
          <span className="message-link" title={href}>
            {children}
          </span>
        ),
        img: ({ alt }) => <span className="image-placeholder">[Image: {alt || 'not loaded'}]</span>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
