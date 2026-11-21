import { useEffect, useRef, useState } from 'react';
import { GitBranch, MessageSquare, Star } from 'lucide-react';
import type { Conversation } from '../domain/types';
import type { WorkspaceController } from './useWorkspace';
import { titleMatch } from '../domain/chatSearch';
import { errorDetail } from '../domain/errors';
import { controlSlug } from '../components/ActionMenu';
import ConversationMenu from './ConversationMenu';

export default function ChatHistoryRow({
  controller,
  value,
  query,
  messageMatch = false,
  navigationDisabled,
}: {
  controller: WorkspaceController;
  value: Conversation;
  query: string;
  messageMatch?: boolean;
  navigationDisabled: boolean;
}) {
  const { projects, chat, panel, view } = controller;
  const project = projects.projects.find((item) => item.id === value.projectId);
  const selected = view === 'chat' && chat.id === value.id && panel !== 'settings';
  const renaming = controller.renamingChatId === value.id;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (renaming) {
      input.current?.focus();
      input.current?.select();
    }
  }, [renaming]);
  const match = titleMatch(value.title, query);
  const mutationReason =
    controller.generating && chat.id === value.id
      ? 'Available when the current response finishes or is stopped'
      : controller.editingBusy && chat.id === value.id
        ? 'Wait for this chat to finish saving.'
        : projects.busy
          ? 'Wait for the project change to finish.'
          : undefined;
  function finish() {
    controller.renameChat(null);
    requestAnimationFrame(() => button.current?.focus());
  }
  async function saveTitle() {
    if (saving) return;
    const title = input.current?.value ?? value.title;
    if (!title.trim()) {
      finish();
      return;
    }
    setSaving(true);
    try {
      await controller.updateChatMetadata(value, { title: title.trim() });
      finish();
    } catch (failure) {
      setError(errorDetail(failure).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={`conversation-row ${selected ? 'selected' : ''}`}>
      {renaming ? (
        <form
          className="chat-rename"
          onSubmit={(event) => {
            event.preventDefault();
            void saveTitle();
          }}
        >
          <input
            ref={input}
            aria-label="Chat title"
            defaultValue={value.title}
            disabled={saving}
            aria-invalid={!!error}
            onChange={() => {
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !saving) {
                event.preventDefault();
                event.stopPropagation();
                finish();
              }
            }}
          />
          {error && (
            <span role="alert" className="field-error">
              {error}
            </span>
          )}
          <span className="field-help">Enter to save · Esc to cancel</span>
        </form>
      ) : (
        <button
          ref={button}
          disabled={navigationDisabled && value.id !== chat.id}
          onClick={() => controller.openChat(value)}
          title={value.title}
          aria-current={selected ? 'page' : undefined}
          data-control-id={`button-${value.projectId ? 'chat-' : ''}${controlSlug(value.title)}`}
        >
          {value.starred ? (
            <Star size={15} className="chat-star" fill="currentColor" aria-label="Starred" />
          ) : value.branchedFrom ? (
            <GitBranch size={15} aria-hidden="true" />
          ) : (
            <MessageSquare size={15} />
          )}
          <span className="project-row-text">
            <span>
              {match ? (
                <>
                  {value.title.slice(0, match.start)}
                  <mark>{value.title.slice(match.start, match.end)}</mark>
                  {value.title.slice(match.end)}
                </>
              ) : (
                value.title
              )}
            </span>
            {messageMatch && !match && (
              <span className="project-row-project">Match in chat text</span>
            )}
            {project && (
              <span className="project-row-project">
                in {project.name}
                {project.archived ? ' · archived' : ''}
              </span>
            )}
          </span>
        </button>
      )}
      {!renaming && (
        <ConversationMenu
          conversation={value}
          disabled={!controller.native}
          readOnly={!!project?.archived}
          actionBusyReason={mutationReason}
          metadataBusyReason={
            controller.generating || controller.editingBusy
              ? 'Available when the current response finishes or is stopped'
              : undefined
          }
          onStar={() =>
            void controller.updateChatMetadata(value, { starred: !value.starred }).catch(() => {})
          }
          onRename={() => {
            setError('');
            controller.renameChat(value.id);
          }}
          onExport={(reasoning) => void controller.exportChat(value, reasoning)}
          onMove={() => controller.setProjectDialog({ kind: 'move', conversationId: value.id })}
          onRemove={() =>
            void controller
              .moveChat(value, null)
              .catch((failure) => projects.setError(errorDetail(failure).message))
          }
          onDelete={() => controller.requestDeleteChat(value)}
        />
      )}
    </div>
  );
}
