import { CircleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

export default function Feedback({
  title,
  children,
  actions,
  details,
  severity = 'error',
  onDismiss,
  announce = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  details?: string;
  severity?: 'error' | 'warning';
  onDismiss?: () => void;
  announce?: boolean;
}) {
  return (
    <div
      className={`feedback ${severity}`}
      role={announce ? (severity === 'error' ? 'alert' : 'status') : undefined}
    >
      <CircleAlert size={18} className="feedback-icon" aria-hidden="true" />
      <div className="feedback-content">
        <strong>{title}</strong>
        <div className="feedback-body">{children}</div>
        {details && (
          <details className="feedback-details">
            <summary>Technical details</summary>
            <pre>{details}</pre>
          </details>
        )}
        {actions && <div className="feedback-actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button className="feedback-dismiss" aria-label={`Dismiss ${title}`} onClick={onDismiss}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
