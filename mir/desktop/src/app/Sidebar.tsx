import { Plus, HardDrive, MessageSquare, Trash2, Settings2, Terminal } from 'lucide-react';
import { newConversation, fileName } from '../domain/types';
import { statusLabel } from '../components/statusLabels';
import { invoke } from '../services/desktop';
import type { WorkspaceController } from './useWorkspace';
export default function Sidebar({ controller }: { controller: WorkspaceController }) {
  const {
    generating,
    updateChat,
    setInput,
    setPanel,
    panel,
    config,
    conversations,
    chat,
    openConversation,
    setConfirmation,
    saveQueue,
    setConversations,
    chatRef,
    server,
    storageError,
  } = controller;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-symbol">
          m<span>·</span>
        </span>
        <span>
          Mir.cpp<small>YOUR LOCAL SPACE</small>
        </span>
      </div>
      <button
        className="new-chat"
        disabled={generating || (!!storageError && chat.messages.length > 0)}
        onClick={() => {
          updateChat(newConversation());
          setInput('');
          setPanel(null);
        }}
      >
        <Plus size={17} /> New chat
      </button>
      <nav aria-label="Workspace">
        <button
          className={panel === 'models' ? 'nav-item selected' : 'nav-item'}
          onClick={() => setPanel('models')}
        >
          <HardDrive size={17} /> Models{' '}
          <span className="count">{config?.models.length ?? '—'}</span>
        </button>
      </nav>
      <div className="section-label">CONVERSATIONS</div>
      <div className="conversation-list">
        {conversations.length === 0 && (
          <p className="history-empty">
            Your conversations stay
            <br />
            on this device.
          </p>
        )}
        {conversations.map((value) => (
          <div
            key={value.id}
            className={`conversation-row ${chat.id === value.id ? 'selected' : ''}`}
          >
            <button
              disabled={generating || (!!storageError && chat.messages.length > 0)}
              onClick={() => {
                openConversation(value);
                setPanel(null);
              }}
              title={value.title}
            >
              <MessageSquare size={15} />
              <span>{value.title}</span>
            </button>
            <button
              className="delete-chat"
              aria-label={`Delete ${value.title}`}
              disabled={generating}
              onClick={() =>
                setConfirmation({
                  title: 'Delete conversation?',
                  text: `“${value.title}” will be permanently removed from this device.`,
                  action: async () => {
                    await saveQueue.current.catch(() => {});
                    await invoke('history_delete', { id: value.id });
                    setConversations((values) => values.filter((c) => c.id !== value.id));
                    if (chatRef.current.id === value.id) updateChat(newConversation());
                  },
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => setPanel('settings')}>
          <Settings2 size={17} /> Settings
        </button>
        <button className="server-card" onClick={() => setPanel('logs')}>
          <span className={`status-dot ${server.phase}`} />
          <span>
            {statusLabel[server.phase]}
            <small>{server.model ? fileName(server.model) : 'Local inference engine'}</small>
          </span>
          <Terminal size={16} />
        </button>
        <span className="version">
          MIR.CPP <span>Desktop preview · 0.1</span>
        </span>
      </div>
    </aside>
  );
}
