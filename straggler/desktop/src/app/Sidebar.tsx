import ConversationMenu from './ConversationMenu';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  MessageSquare,
  Settings2,
  Import,
  Folder,
  Folders,
} from 'lucide-react';
import { controlSlug } from '../components/ActionMenu';
import { newConversation } from '../domain/types';
import { projectUpdatedAt } from '../domain/projects';
import type { Conversation } from '../domain/types';
import { errorDetail } from '../domain/errors';
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
    generating,
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

  async function removeFromProject(value: Conversation) {
    try {
      await controller.moveChat(value, null);
    } catch (failure) {
      projects.setError(errorDetail(failure).message);
    }
  }
  return (
    <aside id="sidebar" className={`sidebar ${preferences.sidebarCollapsed ? 'is-compact' : ''}`}>
      <div className="brand">
        <img className="brand-symbol" src={brandMark} width={32} height={32} alt="" />
        <span className="brand-name">
          Straggler<small>YOUR LOCAL SPACE</small>
        </span>
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
        <span>CONVERSATIONS</span>
        <button
          type="button"
          className="section-action"
          aria-label="Import conversation"
          title="Import a conversation from a .json export"
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
            Your conversations stay
            <br />
            on this device.
          </p>
        )}
        {conversations.map((value) => {
          const project = projects.projects.find((item) => item.id === value.projectId);
          const selected = view === 'chat' && chat.id === value.id && panel !== 'settings';
          const mutationReason =
            generating && chat.id === value.id
              ? 'Available when the current response finishes or is stopped'
              : editingBusy && chat.id === value.id
                ? 'Wait for this chat to finish saving.'
                : projects.busy
                  ? 'Wait for the project change to finish.'
                  : undefined;
          return (
            <div key={value.id} className={`conversation-row ${selected ? 'selected' : ''}`}>
              <button
                disabled={conversationNavigationDisabled && value.id !== chat.id}
                onClick={() => openChat(value)}
                title={value.title}
                aria-current={selected ? 'page' : undefined}
                data-control-id={`button-${value.projectId ? 'chat-' : ''}${controlSlug(value.title)}`}
              >
                <MessageSquare size={15} />
                <span className="project-row-text">
                  <span>{value.title}</span>
                  {project && (
                    <span className="project-row-project">
                      in {project.name}
                      {project.archived ? ' · archived' : ''}
                    </span>
                  )}
                </span>
              </button>
              <ConversationMenu
                conversation={value}
                onExport={(includesReasoning) =>
                  void controller.exportChat(value, includesReasoning)
                }
                disabled={!controller.native}
                readOnly={!!project?.archived}
                actionBusyReason={mutationReason}
                onMove={() =>
                  controller.setProjectDialog({ kind: 'move', conversationId: value.id })
                }
                onRemove={() => void removeFromProject(value)}
                onDelete={() => controller.requestDeleteChat(value)}
              />
            </div>
          );
        })}
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
