import type { WorkspaceController } from './useWorkspace';
import Feedback from '../components/Feedback';
import { useId } from 'react';
import type { ReactNode } from 'react';

export function ConfirmationFrame({
  title,
  description,
  children,
  project = false,
  role = 'alertdialog',
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  project?: boolean;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
}) {
  const id = useId();
  return (
    <div className="confirmation-backdrop">
      <section
        className={`confirmation${project ? ' project-dialog' : ''}`}
        role={role}
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-body` : undefined}
        data-project-dialog={project || undefined}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p id={`${id}-body`}>{description}</p>}
        {children}
      </section>
    </div>
  );
}
export default function ConfirmationDialog({ controller }: { controller: WorkspaceController }) {
  const { confirmation, confirmError, confirmBusy, setConfirmation, confirm } = controller;
  if (!confirmation) return null;
  return (
    <ConfirmationFrame title={confirmation.title} description={confirmation.text}>
      {confirmError && (
        <Feedback title="The action could not be completed" details={confirmError}>
          Review the details before trying again. This window remains open.
        </Feedback>
      )}
      <div className="panel-actions">
        <button disabled={confirmBusy} onClick={() => setConfirmation(null)}>
          Cancel
        </button>
        <button
          className={confirmation.destructive ? 'danger-button' : 'primary-button'}
          disabled={confirmBusy}
          onClick={() => void confirm()}
        >
          {confirmBusy ? 'Working…' : confirmation.actionLabel}
        </button>
      </div>
    </ConfirmationFrame>
  );
}
