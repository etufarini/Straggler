import type { WorkspaceController } from './useWorkspace';
export default function ConfirmationDialog({ controller }: { controller: WorkspaceController }) {
  const { confirmation, confirmError, confirmBusy, setConfirmation, confirm } = controller;
  if (!confirmation) return null;
  return (
    <div className="confirmation-backdrop">
      <section
        className="confirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{confirmation.title}</h2>
        <p>{confirmation.text}</p>
        {confirmError && <p role="alert">{confirmError}</p>}
        <div className="panel-actions">
          <button disabled={confirmBusy} onClick={() => setConfirmation(null)}>
            Cancel
          </button>
          <button className="primary-button" disabled={confirmBusy} onClick={() => void confirm()}>
            {confirmBusy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </section>
    </div>
  );
}
