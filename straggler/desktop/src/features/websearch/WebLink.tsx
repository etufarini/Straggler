import { useState } from 'react';
import type { ReactNode } from 'react';
import { openWebUrl } from '../../services/desktop';
import { emailLink } from '../../domain/emailLinks';
import { sourceUrl } from '../../domain/webSearch';
import { errorDetail } from '../../domain/errors';

export default function WebLink({
  url,
  children,
  className,
  label,
  title,
}: {
  url: string;
  children: ReactNode;
  className?: string;
  label?: string;
  title?: string;
}) {
  const [error, setError] = useState('');
  const href = /^mailto:/i.test(url) ? emailLink(url)?.href : sourceUrl(url);
  if (!href) return <span>{children}</span>;
  return (
    <>
      <a
        href={href}
        className={className}
        aria-label={label}
        title={title}
        rel="noreferrer noopener"
        onClick={(event) => {
          event.preventDefault();
          void openWebUrl(href).catch((failure) =>
            setError(
              `Couldn’t complete the action. Check the details and try again. ${errorDetail(failure).message}`,
            ),
          );
        }}
      >
        {children}
      </a>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
