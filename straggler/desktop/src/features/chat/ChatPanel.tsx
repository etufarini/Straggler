import { Paperclip } from 'lucide-react';
import { attachmentTypesLabel } from '../../domain/attachments';
import RichComposer, { FormattingToggle, composerHint } from './composer/RichComposer';
import type { ComposerContext } from './composer/commands';
import WebSearchMenu from '../websearch/WebSearchMenu';
import WebSearchActivity from '../websearch/WebSearchActivity';
import Sources from '../websearch/Sources';
import ReasoningMenu from './ReasoningMenu';
import SystemPromptMenu from './SystemPromptMenu';
import ContextCounter from './ContextCounter';
import useComposerDensity from './useComposerDensity';
import Markdown from './Markdown';
import {
  ArrowUp,
  HardDrive,
  Check,
  Copy,
  Square,
  Pencil,
  RotateCcw,
  Folder,
  GitBranch,
} from 'lucide-react';
import { fileName } from '../../domain/types';
import type { ProjectPassage } from '../../domain/types';
import { messageStatusLabel } from '../../components/statusLabels';
import Feedback from '../../components/Feedback';
import StorageFeedback from './StorageFeedback';
import type { WorkspaceController } from '../../app/useWorkspace';
import { useEffect, useRef, useState } from 'react';
import { errorDetail } from '../../domain/errors';
import { isContextRejection } from '../../domain/errors';
import { ProjectLimitFeedback } from '../projects/ProjectCapacity';
import brandMark from '../../assets/brand-mark.svg';
export default function ChatPanel({
  controller,
  onProjectSource,
}: {
  controller: WorkspaceController;
  onProjectSource: (source: ProjectPassage) => void;
}) {
  const [copied, setCopied] = useState('');
  const [composerMode, setComposerMode] = useState<ComposerContext>('text');
  const toolbarVisible = controller.preferences.formattingToolbarVisible !== false;
  const toggleFormatting = (visible: boolean) =>
    controller.changePreferences({ formattingToolbarVisible: visible });
  const lastEditor = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastEditor.current;
    lastEditor.current = controller.editor?.messageId ?? null;
    if (controller.editor && !controller.generating) {
      const field = document.getElementById(`edit-${controller.editor.messageId}`);
      field?.focus();
      field?.closest('.message-editor')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } else if (previous && !controller.editor) document.getElementById(`edit-${previous}`)?.focus();
  }, [controller.editor?.messageId, controller.generating]);
  const composerRef = useComposerDensity();
  const [copyError, setCopyError] = useState<{ messageId: string; detail: string } | null>(null);
  const {
    editor,
    setEditor,
    editingBusy,
    beginEdit,
    saveEdit,
    regenerate,
    follow,
    chat,
    setInput,
    composerInput,
    active,
    setPanel,
    setError,
    messageList,
    canSend,
    send,
    sendPromise,
    server,
    input,
    generating,
    cancel,
    reviewSettings,
  } = controller;
  useEffect(() => {
    if (generating) composerInput.current?.focus();
  }, [generating, composerInput]);
  const project = controller.currentProject;
  const archived = !!project?.archived;
  const projectContext = project && controller.projects.context(project);
  const branchDisabledReason = controller.temporary
    ? 'Branching is unavailable in temporary chats.'
    : archived
      ? 'Restore this project to branch its chats.'
      : !controller.historyReady || !!controller.storageError
        ? 'Chat storage must be available to create a branch.'
        : generating || editingBusy || controller.importBusy
          ? 'Wait for the current chat operation to finish.'
          : '';
  const branchOrigin = chat.branchedFrom;
  const original =
    branchOrigin &&
    controller.conversations.find((value) => value.id === branchOrigin.conversationId);
  const branchDivider = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!branchOrigin) return;
    const divider = branchDivider.current;
    divider?.focus({ preventScroll: true });
    divider?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [chat.id, branchOrigin?.messageId]);
  const divider = branchOrigin ? (
    <aside className="branch-divider" aria-label="Branch origin" tabIndex={-1} ref={branchDivider}>
      <GitBranch size={15} aria-hidden="true" />
      <span role="status">
        {original ? `Branched from ‘${original.title}’` : 'Original chat deleted'}
      </span>
      {original && (
        <button
          type="button"
          className="text-button"
          disabled={generating || editingBusy || controller.importBusy}
          onClick={() => {
            controller.openChat(original, true);
            follow.current = false;
            requestAnimationFrame(() => {
              document.getElementById(`edit-${branchOrigin.messageId}`)?.focus();
            });
          }}
        >
          Open original
        </button>
      )}
    </aside>
  ) : null;
  const hasBranchPoint =
    branchOrigin && chat.messages.some((message) => message.id === branchOrigin.messageId);
  return (
    <>
      {project && (
        <nav className="project-crumb" aria-label="Breadcrumb">
          <button
            data-control-id="button-crumb-project"
            onClick={() => controller.openProject(project.id)}
          >
            <Folder size={14} />
            {project.name}
          </button>
          <span aria-hidden="true">›</span>
          <span aria-current="page">{chat.title}</span>
        </nav>
      )}
      <div
        className="messages"
        ref={messageList}
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        {chat.messages.length === 0 ? (
          <div className="welcome">
            <h1>{controller.temporary ? 'Temporary chat' : 'What’s on your mind?'}</h1>
            {controller.temporary ? (
              <p>Not saved. Leaving erases this chat unless you save it.</p>
            ) : (
              <p>Powered by a model on this computer.</p>
            )}
            <div className="suggestions">
              {[
                [
                  'Explore an idea',
                  'Help me explore an idea by asking me a few thoughtful questions.',
                ],
                [
                  'Make something clear',
                  'Help me understand a topic. Ask me what I would like to learn.',
                ],
                [
                  'Start writing',
                  'Help me get started on a piece of writing. Ask me about its purpose and audience.',
                ],
              ].map(([label, prompt]) => (
                <button
                  key={label}
                  onClick={() => {
                    setInput(prompt);
                    composerInput.current?.focus();
                  }}
                >
                  <span>{label}</span>
                  <ArrowUp size={15} />
                </button>
              ))}
            </div>
            {!active && (
              <button className="welcome-load" onClick={() => setPanel('models')}>
                <HardDrive size={15} />
                Choose a model to get started <span>→</span>
              </button>
            )}
          </div>
        ) : (
          <div className="message-column">
            {!hasBranchPoint && divider}
            {chat.messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-avatar">
                  {message.role === 'user' ? (
                    'Y'
                  ) : (
                    <img src={brandMark} width={22} height={22} alt="" />
                  )}
                </div>
                <div className="message-body">
                  <div className="message-heading">
                    {message.role === 'user' ? 'You' : 'Straggler'}
                    {message.role === 'assistant' && (
                      <span>
                        {message.model || chat.model
                          ? fileName(message.model || chat.model!)
                          : 'Local model'}
                      </span>
                    )}
                  </div>
                  {message.role === 'assistant' && (
                    <WebSearchActivity
                      message={message}
                      search={controller.webSearch}
                      onSettings={() => reviewSettings('websearch')}
                    />
                  )}
                  {message.projectSources && (
                    <ProjectSearchActivity sources={message.projectSources} />
                  )}
                  {message.reasoning && (
                    <details className="reasoning">
                      <summary>Reasoning</summary>
                      <Markdown>{message.reasoning}</Markdown>
                    </details>
                  )}
                  {editor?.messageId === message.id ? (
                    <div
                      className="message-editor"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && !editingBusy && !generating) {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditor(null);
                        }
                      }}
                    >
                      {message.role === 'user' ? (
                        <RichComposer
                          key={message.id}
                          id={`edit-${message.id}`}
                          label="Edit message"
                          describedBy={`edit-note-${message.id}`}
                          value={editor.text}
                          disabled={editingBusy || generating}
                          editing
                          toolbarVisible={toolbarVisible}
                          onChange={(text) => setEditor({ ...editor, text })}
                          onSubmit={() => {
                            if (!editingBusy && !generating) void saveEdit().catch(() => {});
                          }}
                        />
                      ) : (
                        <textarea
                          autoFocus
                          id={`edit-${message.id}`}
                          aria-label="Edit response"
                          aria-describedby={`edit-note-${message.id}`}
                          rows={10}
                          value={editor.text}
                          disabled={editingBusy || generating}
                          onChange={(event) => setEditor({ ...editor, text: event.target.value })}
                        />
                      )}
                      <div className="message-editor-footer">
                        {message.role === 'user' && (
                          <FormattingToggle
                            visible={toolbarVisible}
                            onChange={toggleFormatting}
                            disabled={!controller.preferencesReady}
                          />
                        )}
                        <p className="message-editor-note" id={`edit-note-${message.id}`}>
                          {message.role === 'user'
                            ? chat.messages.findIndex((value) => value.id === message.id) <
                              chat.messages.length - 2
                              ? 'Saving replaces the response below and removes later messages.'
                              : 'Saving replaces the response below with a new response.'
                            : chat.messages.at(-1)?.id !== message.id
                              ? 'Saving replaces this response and removes later messages. The model is not run again.'
                              : 'Your text replaces this response and is used as context for later messages. The model is not run again.'}
                        </p>
                        <div className="message-editor-actions">
                          <button
                            className="message-editor-cancel"
                            type="button"
                            disabled={editingBusy || generating}
                            onClick={() => setEditor(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={
                              editingBusy ||
                              generating ||
                              !editor.text.trim() ||
                              (message.role === 'user' && server.phase !== 'ready')
                            }
                            onClick={() => void saveEdit().catch(() => {})}
                          >
                            {message.role === 'user' ? 'Save and regenerate' : 'Save response'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="markdown">
                      <Markdown
                        user={message.role === 'user'}
                        sources={message.sources}
                        projectSources={message.projectSources}
                        onProjectSource={onProjectSource}
                      >
                        {message.content}
                      </Markdown>
                    </div>
                  )}
                  {!!(message.sources?.length || message.projectSources?.length) && (
                    <Sources
                      sources={message.sources}
                      projectSources={message.projectSources}
                      onProjectSource={onProjectSource}
                    />
                  )}
                  {message.status === 'streaming' && (
                    <span className="typing-indicator">
                      {message.content ? 'Generating' : 'Thinking'}
                    </span>
                  )}
                  {messageStatusLabel[message.status] && !(message.error && !server.issue) && (
                    <div className="message-status">{messageStatusLabel[message.status]}</div>
                  )}
                  {message.error && !server.issue && (
                    <Feedback
                      title={
                        message.status === 'interrupted'
                          ? 'Response interrupted'
                          : 'Response failed'
                      }
                      details={message.error}
                      actions={
                        project && isContextRejection(message.error) ? (
                          <>
                            <button
                              className="text-button"
                              data-control-id="button-review-files"
                              onClick={() => controller.openProject(project.id, true)}
                            >
                              Review files
                            </button>
                            <button
                              className="text-button"
                              data-control-id="button-change-context-size"
                              onClick={() => reviewSettings('model')}
                            >
                              Change context size in Settings
                            </button>
                          </>
                        ) : (
                          <button className="text-button" onClick={() => reviewSettings('model')}>
                            Review settings
                          </button>
                        )
                      }
                    >
                      {message.content
                        ? 'The partial response is kept.'
                        : 'The server couldn’t complete this request. Check the details and try again.'}
                    </Feedback>
                  )}
                  {editor?.messageId !== message.id &&
                    (message.role === 'user' ||
                      (message.status !== 'streaming' && message.status !== 'error')) && (
                      <div className="message-actions" role="group" aria-label="Message actions">
                        <button
                          type="button"
                          className="message-action"
                          aria-label={message.role === 'user' ? 'Copy message' : 'Copy response'}
                          title={message.role === 'user' ? 'Copy message' : 'Copy response'}
                          onClick={async () => {
                            setCopyError(null);
                            try {
                              await navigator.clipboard.writeText(message.content);
                              setCopied(message.id);
                              setTimeout(() => setCopied(''), 1600);
                            } catch (e) {
                              setCopyError({
                                messageId: message.id,
                                detail: errorDetail(e).message,
                              });
                            }
                          }}
                        >
                          {copied === message.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button
                          type="button"
                          className="message-action"
                          id={`edit-${message.id}`}
                          aria-label={message.role === 'user' ? 'Edit message' : 'Edit response'}
                          title={message.role === 'user' ? 'Edit message' : 'Edit response'}
                          disabled={generating || editingBusy || archived}
                          aria-describedby={generating ? `actions-busy-${message.id}` : undefined}
                          onClick={() => beginEdit(message)}
                        >
                          <Pencil size={14} />
                        </button>
                        {message.role === 'assistant' && (
                          <span title={branchDisabledReason || undefined}>
                            <button
                              type="button"
                              className="message-action"
                              aria-label="Branch in new chat"
                              title={branchDisabledReason || 'Branch in new chat'}
                              disabled={!!branchDisabledReason}
                              onClick={() => void controller.branchChat(message.id)}
                            >
                              <GitBranch size={14} />
                            </button>
                          </span>
                        )}
                        {message.role === 'user' && (
                          <button
                            type="button"
                            className="message-action"
                            aria-label="Regenerate response"
                            title="Regenerate response"
                            disabled={
                              generating ||
                              editingBusy ||
                              server.phase !== 'ready' ||
                              !!controller.storageError ||
                              archived
                            }
                            aria-describedby={generating ? `actions-busy-${message.id}` : undefined}
                            onClick={() => void regenerate(message.id).catch(() => {})}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {generating && (
                          <p className="message-actions-note" id={`actions-busy-${message.id}`}>
                            Edit and regenerate when the response ends.
                          </p>
                        )}
                      </div>
                    )}
                  {controller.branchError?.chatId === chat.id &&
                    controller.branchError.messageId === message.id && (
                      <Feedback
                        title="Couldn’t create the branch"
                        details={controller.branchError.detail}
                      >
                        Try branching from this response again.
                      </Feedback>
                    )}
                  {copyError?.messageId === message.id && (
                    <Feedback
                      title="Text could not be copied"
                      details={copyError.detail}
                      onDismiss={() => setCopyError(null)}
                    >
                      Select the text and copy it manually.
                    </Feedback>
                  )}
                  {message.id === branchOrigin?.messageId && divider}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <StorageFeedback controller={controller} />
        {chat.projectId && !project && (
          <Feedback
            title="Project data is unavailable"
            actions={
              <button onClick={() => void controller.projects.load()}>
                Retry loading projects
              </button>
            }
          >
            Reload projects before continuing this conversation.
          </Feedback>
        )}
        {project &&
          (archived ? (
            <Feedback
              severity="warning"
              title="This project is archived"
              actions={
                <button
                  className="text-button"
                  data-control-id="button-restore-from-chat"
                  onClick={() =>
                    void controller.projects
                      .update(project.id, { archived: false })
                      .then((result) =>
                        controller.projects.setNotice({
                          message: `Restored “${project.name}”.`,
                          undoToken: result.undoToken,
                        }),
                      )
                      .catch(() => {})
                  }
                >
                  Restore project
                </button>
              }
            >
              You can read this chat. Restore the project to continue it.
            </Feedback>
          ) : projectContext?.search ? (
            <p className="project-search-status" role="status">
              Search mode · Project files
              <button
                type="button"
                className="text-button"
                onClick={() => controller.openProject(project.id, true)}
              >
                Review files
              </button>
            </p>
          ) : (
            projectContext && (
              <ProjectLimitFeedback
                chat
                context={projectContext}
                onReviewFiles={() => controller.openProject(project.id, true)}
                onChangeContext={() => reviewSettings('model')}
              />
            )
          ))}
        {(controller.contextEstimate.overflow || controller.contextError) && (
          <p role="alert" className="context-overflow">
            {controller.contextEstimate.overflow
              ? `The prompt and attachments exceed the ${controller.contextEstimate.capacity?.toLocaleString('en-US')}-token context. Remove files, shorten your message or increase the context size.`
              : controller.contextError}
          </p>
        )}
        {!controller.attachments.visionSupported &&
          controller.attachments.rows.some((row) => row.attachment?.image) && (
            <Feedback
              severity="warning"
              title="This model can’t read images. It won’t be sent."
              actions={
                <>
                  <button onClick={() => controller.setPanel('models')}>Choose model</button>
                  <button
                    disabled={controller.attachments.disabled}
                    onClick={() => {
                      const row = controller.attachments.rows.find((row) => row.attachment?.image);
                      if (row) void controller.attachments.removeFile(row);
                    }}
                  >
                    Remove image
                  </button>
                </>
              }
            >
              <span>Choose a model that supports images, or remove the image.</span>
            </Feedback>
          )}
        <form
          ref={composerRef}
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) {
              const pending = send();
              sendPromise.current = pending;
              void pending;
            }
          }}
        >
          <RichComposer
            key={chat.id}
            focusRef={composerInput}
            label="Message"
            controlId="textarea-message"
            placeholder={
              server.phase === 'ready'
                ? 'Message your local model…'
                : server.issue
                  ? 'Review settings and restart the server to continue…'
                  : 'Load a model to start chatting…'
            }
            value={input}
            disabled={archived || server.phase !== 'ready'}
            toolbarVisible={toolbarVisible}
            onChange={setInput}
            onContextChange={setComposerMode}
            onSubmit={() => composerRef.current?.requestSubmit()}
          />
          <div className="composer-footer">
            <div className="composer-tools" role="group" aria-label="Message options">
              <FormattingToggle
                visible={toolbarVisible}
                onChange={toggleFormatting}
                disabled={!controller.preferencesReady}
              />
              <button
                type="button"
                className="composer-chip attach-chip"
                aria-label="Attach files"
                title={attachmentTypesLabel}
                disabled={controller.attachments.disabled}
                onClick={() => void controller.attachments.chooseFiles()}
              >
                <Paperclip size={15} />
              </button>
              <SystemPromptMenu controller={controller} />
              <ReasoningMenu controller={controller} />
              <WebSearchMenu controller={controller} />
            </div>
            <div className="composer-send">
              <span className="keyboard-hint">{composerHint(composerMode)}</span>
              <ContextCounter controller={controller} />
              {generating ? (
                <button
                  type="button"
                  className="send-button stop"
                  aria-label="Stop response"
                  onClick={(event) => {
                    // Stop can become Send before this click's default action runs.
                    event.preventDefault();
                    void cancel().catch((e) => setError(String(e)));
                  }}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send message"
                  data-control-id="button-send-message"
                  disabled={!canSend || !input.trim()}
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="composer-note">Models can make mistakes. Check important information.</p>
      </div>
    </>
  );
}

function ProjectSearchActivity({ sources }: { sources: ProjectPassage[] }) {
  const files = new Set(sources.map((source) => source.fileId)).size;
  return (
    <p className="web-search-activity reasoning" role="status">
      {sources.length
        ? `Searched project files · ${sources.length} ${sources.length === 1 ? 'passage' : 'passages'} from ${files} ${files === 1 ? 'file' : 'files'}`
        : 'Searched project files · No passages fit or matched this message.'}
    </p>
  );
}
