import Feedback from '../../components/Feedback';
import type { WorkspaceController } from '../../app/useWorkspace';

export default function StorageFeedback({ controller }: { controller: WorkspaceController }) {
  const { storageError, historyReady, chat, save, loadHistory } = controller;
  if (!storageError) return null;
  return (
    <Feedback
      title={historyReady ? 'Conversation not saved' : 'Conversation history unavailable'}
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
        ? 'Your current text remains in this window. Save it before leaving this conversation.'
        : 'Saved conversations could not be loaded. Your files have been kept.'}
    </Feedback>
  );
}
