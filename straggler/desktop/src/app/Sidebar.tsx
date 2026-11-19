import { useEffect, useRef, useState } from 'react';
import ChatHistoryRow from './ChatHistoryRow';
import { searchChatMessages } from '../services/desktop';
import { titleMatch } from '../domain/chatSearch';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Import,
  Folder,
  Folders,
} from 'lucide-react';
import { controlSlug } from '../components/ActionMenu';
import { newConversation } from '../domain/types';
import { projectUpdatedAt } from '../domain/projects';
import type { Conversation } from '../domain/types';
import type { WorkspaceController } from './useWorkspace';
import brandMark from '../assets/brand-mark.svg';

export default function Sidebar({ controller }: { controller: WorkspaceController }) {
  const {
    chatOptionsDisabled,
    editingBusy,
    setPanel,
    panel,
    conversations,
    chat,
    openChat,
    preferences,
    preferencesReady,
    changePreferences,
    storageError,
    projects,
    view,
    projectId,
  } = controller;
  const starred = projects.projects
    .filter((project) => project.starred && !project.archived)
    .sort(
      (left, right) =>
        projectUpdatedAt(right, conversations) - projectUpdatedAt(left, conversations),
    );
  const conversationNavigationDisabled =
    controller.busy ||
    editingBusy ||
    controller.importBusy ||
    (!controller.temporary &&
      (chatOptionsDisabled || (!!storageError && chat.messages.length > 0)));

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [bodyResult, setBodyResult] = useState<{
    query: string;
    conversations: Conversation[];
    ids: Set<string> | null;
  } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (controller.renamingChatId) setQuery('');
  }, [controller.renamingChatId]);
  function openSearch() {
    changePreferences({ sidebarCollapsed: false });
    setSearching(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'KeyK'
      ) {
        event.preventDefault();
        searchButton.current?.click();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const needle = query.trim();
  useEffect(() => {
    if (!searching || !needle || !controller.historyReady) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void searchChatMessages(needle).then(
        (ids) => {
          if (!disposed) setBodyResult({ query: needle, conversations, ids: new Set(ids) });
        },
        () => {
          if (!disposed) setBodyResult({ query: needle, conversations, ids: null });
        },
      );
    }, 180);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [searching, needle, conversations, controller.historyReady]);
  const currentResult =
    bodyResult?.query === needle && bodyResult.conversations === conversations ? bodyResult : null;
  const searchingMessages = !!needle && controller.historyReady && !currentResult;
  const filtered = conversations.filter(
    (value) => !needle || titleMatch(value.title, query) || currentResult?.ids?.has(value.id),
  );
  const groups =
    searching && query.trim()
      ? [
          { label: 'Chats', chats: filtered.filter((value) => !value.projectId) },
          { label: 'In projects', chats: filtered.filter((value) => value.projectId) },
        ]
      : [
          { label: 'STARRED', chats: filtered.filter((value) => value.starred) },
          { label: 'CHATS', chats: filtered.filter((value) => !value.starred) },
        ];
  return (
    <aside id="sidebar" className={`sidebar ${preferences.sidebarCollapsed ? 'is-compact' : ''}`}>
      <div className="brand">
        <img className="brand-symbol" src={brandMark} width={32} height={32} alt="" />
        <span className="brand-name">Straggler</span>
        <button
          className="sidebar-toggle"
          aria-expanded={!preferences.sidebarCollapsed}
          aria-controls="sidebar"
          aria-label={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={preferences.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-control-id={
            preferences.sidebarCollapsed ? 'button-expand-sidebar' : 'button-collapse-sidebar'
          }
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
        data-control-id="button-new-chat"
        disabled={conversationNavigationDisabled}
        onClick={() => openChat(newConversation())}
      >
        <Plus size={17} /> <span className="sidebar-label">New chat</span>
      </button>
      <div className="sidebar-projects">
        <div className="section-label has-action">
          <span>PROJECTS</span>
          <button
            type="button"
            className="section-action"
            aria-label="New project"
            title="Create a project"
            data-control-id="button-new-project"
            disabled={!controller.native || !projects.ready || projects.busy}
            onClick={(event) =>
              controller.setProjectDialog({ kind: 'create' }, event.currentTarget)
            }
          >
            <Plus size={13} />
            <span>New</span>
          </button>
        </div>
        <div className="sidebar-project-list">
          {starred.map((project) => {
            const selected = view === 'project' && projectId === project.id && panel !== 'settings';
            return (
              <div key={project.id} className={`sidebar-project-row ${selected ? 'selected' : ''}`}>
                <button
                  type="button"
                  title={project.name}
                  aria-current={selected ? 'page' : undefined}
                  data-control-id={`button-project-${controlSlug(project.name)}`}
                  onClick={() => controller.openProject(project.id)}
                >
                  <Folder size={15} />
                  <span>{project.name}</span>
                </button>
              </div>
            );
          })}
          {projects.ready && projects.projects.length === 0 && (
            <p className="project-sidebar-hint">Group chats that share instructions and files.</p>
          )}
          {projects.ready && projects.projects.length > 0 && starred.length === 0 && (
            <p className="project-sidebar-hint">Star a project to pin it here.</p>
          )}
          <div
            className={`sidebar-project-row is-all-projects ${view === 'projects' && panel !== 'settings' ? 'selected' : ''}`}
          >
            <button
              type="button"
              aria-current={view === 'projects' && panel !== 'settings' ? 'page' : undefined}
              data-control-id="button-all-projects"
              aria-label="All projects"
              onClick={controller.openProjects}
            >
              <Folders size={15} />
              <span className="sidebar-label">All projects</span>
            </button>
          </div>
        </div>
      </div>
      <div className="section-label has-action">
        <span>
          {!query.trim() && conversations.some((value) => value.starred) ? 'STARRED' : 'CHATS'}
        </span>
        <button
          ref={searchButton}
          className="section-action"
          aria-label="Search chats"
          title="Search chats (Ctrl/⌘+K)"
          onClick={openSearch}
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          className="section-action"
          aria-label="Import chat"
          title="Import a chat from a .json export"
          data-control-id="button-import-conversation"
          disabled={!controller.native || controller.importBusy || editingBusy}
          onClick={() => {
            setPanel(null);
            void controller.importChat();
          }}
        >
          <Import size={13} />
          <span>Import</span>
        </button>
      </div>
      <div className="conversation-list">
        {conversations.length === 0 && (
          <p className="history-empty">
            Your chats stay
            <br />
            on this device.
          </p>
        )}
        {searching && (
          <div className="chat-search">
            <input
              ref={searchInput}
              aria-label="Search chats"
              placeholder="Search chats…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setQuery('');
                  setSearching(false);
                  searchButton.current?.focus();
                }
              }}
            />
            <p role="status">
              {filtered.length} {filtered.length === 1 ? 'chat' : 'chats'}
              {searchingMessages && ' · Searching messages…'}
            </p>
            {query && (
              <button
                className="text-button"
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </button>
            )}
          </div>
        )}
        {currentResult?.ids === null && (
          <p className="history-empty" role="alert">
            Couldn’t search chat messages. Title matches are shown.
          </p>
        )}
        {needle && !searchingMessages && currentResult?.ids !== null && filtered.length === 0 && (
          <p className="history-empty">No chats match ‘{query}’</p>
        )}
        {groups.map(
          (group) =>
            group.chats.length > 0 && (
              <div key={group.label}>
                {(group.label === 'In projects' ||
                  (group.label === 'CHATS' && groups[0].chats.length > 0)) && (
                  <div className="section-label">{group.label}</div>
                )}
                {group.chats.map((value) => (
                  <ChatHistoryRow
                    key={value.id}
                    controller={controller}
                    value={value}
                    query={query}
                    messageMatch={!!currentResult?.ids?.has(value.id)}
                    navigationDisabled={conversationNavigationDisabled}
                  />
                ))}
              </div>
            ),
        )}
      </div>
      <div className="sidebar-bottom">
        <button
          className={`nav-item ${panel === 'settings' ? 'selected' : ''}`}
          aria-label="Settings"
          aria-current={panel === 'settings' ? 'page' : undefined}
          title="Settings"
          data-control-id="button-settings"
          onClick={() => setPanel('settings')}
        >
          <Settings2 size={17} /> <span className="sidebar-label">Settings</span>
        </button>
        <span className="version">Desktop preview · 0.1</span>
      </div>
    </aside>
  );
}
