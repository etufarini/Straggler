import ConversationMenu from './ConversationMenu';
import { PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Settings2 } from 'lucide-react';
import { newConversation } from '../domain/types';
import { invoke } from '../services/desktop';
import type { WorkspaceController } from './useWorkspace';
export default function Sidebar({ controller }: { controller: WorkspaceController }) {
  const {
    generating,
    editingBusy,
    updateChat,
    setInput,
    setPanel,
    panel,
    conversations,
    chat,
    openConversation,
    setConfirmation,
    saveQueue,
    setConversations,
    chatRef,
    preferences,
    preferencesReady,
    changePreferences,
    storageError,
  } = controller;
  return (
    <aside id="sidebar" className={`sidebar ${preferences.sidebarCollapsed ? 'is-compact' : ''}`}>
      <div className="brand">
        <span className="brand-symbol">
          m<span>·</span>
        </span>
        <span>
          Mir.cpp<small>YOUR LOCAL SPACE</small>
        </span>
        <button
          className="sidebar-toggle"
          aria-expanded={!preferences.sidebarCollapsed}
          aria-controls="sidebar"
          aria-label={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          disabled={!preferencesReady}
          onClick={() => changePreferences({ sidebarCollapsed: !preferences.sidebarCollapsed })}
        >
          {preferences.sidebarCollapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
      </div>
      <button
        className="new-chat"
        aria-label="New chat"
        title="New chat"
        disabled={editingBusy || generating || (!!storageError && chat.messages.length > 0)}
        onClick={() => {
          openConversation(newConversation());
          setInput('');
          setPanel(null);
        }}
      >
        <Plus size={17} /> <span className="sidebar-label">New chat</span>
      </button>
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
              disabled={editingBusy || generating || (!!storageError && chat.messages.length > 0)}
              onClick={() => {
                openConversation(value);
                setPanel(null);
              }}
              title={value.title}
            >
              <MessageSquare size={15} />
              <span>{value.title}</span>
            </button>
            <ConversationMenu
              conversation={value}
              onExport={(includesReasoning) => void controller.exportChat(value, includesReasoning)}
              disabled={editingBusy || generating}
              onDelete={() =>
                setConfirmation({
                  title: 'Delete conversation?',
                  actionLabel: 'Delete conversation',
                  destructive: true,
                  text: `“${value.title}” will be permanently removed from this device.`,
                  action: async () => {
                    await saveQueue.current.catch(() => {});
                    await invoke('history_delete', { id: value.id });
                    setConversations((values) => values.filter((c) => c.id !== value.id));
                    if (chatRef.current.id === value.id) updateChat(newConversation());
                  },
                })
              }
            />
          </div>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${panel === 'settings' ? 'selected' : ''}`}
          aria-label="Settings"
          aria-current={panel === 'settings' ? 'page' : undefined}
          title="Settings"
          onClick={() => setPanel('settings')}
        >
          <Settings2 size={17} /> <span className="sidebar-label">Settings</span>
        </button>
        <span className="version">Desktop preview · 0.1</span>
      </div>
    </aside>
  );
}
