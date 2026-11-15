import Feedback from '../../components/Feedback';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function StorageFeedback({ controller }: { controller: WorkspaceController }) {
  const { storageError, historyReady, chat, save, loadHistory } = controller;
  return (
    <>
      {controller.importError && (
        <Feedback
          title="Import failed"
          details={controller.importError.details}
          actions={
            <button
              type="button"
              disabled={controller.importBusy}
              onClick={() => void controller.importChat()}
            >
              Choose another file
            </button>
          }
          onDismiss={() => controller.setImportError(null)}
        >
          <strong>{controller.importError.fileName}</strong>
          <p>Existing chats are unchanged. {controller.importError.details}</p>
        </Feedback>
      )}
      {controller.fileNotice && (
        <p role="status" className="success-message">
          {controller.fileNotice}
        </p>
      )}
      {controller.fileError && (
        <Feedback
          title="Export failed"
          details={controller.fileError}
          onDismiss={() => controller.setFileError('')}
        >
          The conversation could not be exported. Choose a writable destination and try again.
        </Feedback>
      )}
      {storageError && (
        <Feedback
          title={historyReady ? 'Chat not saved' : 'Chat history unavailable'}
          details={storageError}
          actions={
            <button
              onClick={() => {
                if (historyReady && chat.messages.length) void save(chat).catch(() => {});
                else void loadHistory();
              }}
            >
              {historyReady ? 'Retry saving' : 'Retry loading'}
            </button>
          }
        >
          {historyReady
            ? 'Your text is still here. Save it before leaving this chat.'
            : 'Saved chats couldn’t be loaded. Your files are untouched.'}
        </Feedback>
      )}
    </>
  );
}
