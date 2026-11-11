import ReasoningMenu from './ReasoningMenu';
import SystemPromptMenu from './SystemPromptMenu';
import ContextCounter from './ContextCounter';
import Markdown from './Markdown';
import { ArrowUp, HardDrive, Check, Copy, Square, Pencil, RotateCcw } from 'lucide-react';
import { fileName } from '../../domain/types';
import { messageStatusLabel } from '../../components/statusLabels';
import Feedback from '../../components/Feedback';
import StorageFeedback from './StorageFeedback';
import type { WorkspaceController } from '../../app/useWorkspace';
import { useEffect, useRef, useState } from 'react';
import { errorDetail } from '../../domain/errors';
export default function ChatPanel({ controller }: { controller: WorkspaceController }) {
  const [copied, setCopied] = useState('');
  const lastEditor = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastEditor.current;
    lastEditor.current = controller.editor?.messageId ?? null;
    if (previous && !controller.editor) document.getElementById(`edit-${previous}`)?.focus();
  }, [controller.editor?.messageId]);
  const composerRef = useRef<HTMLFormElement>(null);
  const [composerWidth, setComposerWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    const measure = () => setComposerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
    textarea,
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
  return (
    <>
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
            <h1>What’s on your mind?</h1>
            <p>
              A conversation, a fresh perspective, a place to think.
              <br />
              Powered by a model running right here.
            </p>
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
                    textarea.current?.focus();
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
            {chat.messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-avatar">{message.role === 'user' ? 'Y' : 'm·'}</div>
                <div className="message-body">
                  <div className="message-heading">
                    {message.role === 'user' ? 'You' : 'Mir.cpp'}
                    {message.role === 'assistant' && (
                      <span>
                        {message.model || chat.model
                          ? fileName(message.model || chat.model!)
                          : 'Local model'}
                      </span>
                    )}
                  </div>
                  {message.reasoning && (
                    <details className="reasoning">
                      <summary>Reasoning</summary>
                      <Markdown>{message.reasoning}</Markdown>
                    </details>
                  )}
                  {editor?.messageId === message.id ? (
                    <div className="message-editor">
                      <textarea
                        autoFocus
                        aria-label={message.role === 'user' ? 'Edit message' : 'Edit response'}
                        aria-describedby={`edit-note-${message.id}`}
                        rows={message.role === 'user' ? 4 : 10}
                        value={editor.text}
                        disabled={editingBusy || generating}
                        onChange={(event) => setEditor({ ...editor, text: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape' && !editingBusy && !generating)
                            setEditor(null);
                        }}
                      />
                      <div className="message-editor-footer">
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
                      <Markdown>{message.content}</Markdown>
                    </div>
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
                        <button className="text-button" onClick={() => reviewSettings('model')}>
                          Review settings
                        </button>
                      }
                    >
                      {message.content
                        ? 'The response could not be completed. Partial text remains in this conversation.'
                        : 'The server could not complete this request. Review the details before trying again.'}
                    </Feedback>
                  )}
                  {editor?.messageId !== message.id &&
                    (message.role === 'user' ||
                      (message.status !== 'streaming' &&
                        message.status !== 'error' &&
                        !!message.content)) && (
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
                          aria-label={message.role === 'user' ? 'Edit message' : 'Edit response'}
                          title={message.role === 'user' ? 'Edit message' : 'Edit response'}
                          disabled={generating || editingBusy}
                          aria-describedby={generating ? `actions-busy-${message.id}` : undefined}
                          onClick={() => beginEdit(message)}
                        >
                          <Pencil size={14} />
                        </button>
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
                              !!controller.storageError
                            }
                            aria-describedby={generating ? `actions-busy-${message.id}` : undefined}
                            onClick={() => void regenerate(message.id).catch(() => {})}
                          >
                            <RotateCcw size={14} />
                          </button>
                        )}
                        {generating && (
                          <p className="message-actions-note" id={`actions-busy-${message.id}`}>
                            Edit and regenerate are available when the response finishes or is
                            stopped.
                          </p>
                        )}
                      </div>
                    )}
                  {copyError?.messageId === message.id && (
                    <Feedback
                      title="Text could not be copied"
                      details={copyError.detail}
                      onDismiss={() => setCopyError(null)}
                    >
                      Select the response text and copy it manually.
                    </Feedback>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <StorageFeedback controller={controller} />
        {(controller.contextEstimate.overflow || controller.contextError) && (
          <p role="alert" className="context-overflow">
            {controller.contextEstimate.overflow
              ? `The prompt and attachments exceed the ${controller.contextEstimate.capacity?.toLocaleString('en-US')}-token context. Remove files, shorten your message or increase the context size.`
              : controller.contextError}
          </p>
        )}
        <form
          ref={composerRef}
          className={`composer ${composerWidth !== null && composerWidth <= 700 ? 'is-narrow' : ''} ${composerWidth !== null && composerWidth <= 480 ? 'is-small' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend) {
              const pending = send();
              sendPromise.current = pending;
              void pending;
            }
          }}
        >
          <textarea
            ref={textarea}
            aria-label="Message"
            placeholder={
              server.phase === 'ready'
                ? 'Message your local model…'
                : server.issue
                  ? 'Review settings and restart the server to continue…'
                  : 'Load a model to start a conversation…'
            }
            value={input}
            disabled={generating}
            rows={3}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <div className="composer-tools" role="group" aria-label="Message options">
              <SystemPromptMenu controller={controller} />
              <ReasoningMenu controller={controller} />
            </div>
            <div className="composer-send">
              <span className="keyboard-hint">Shift + Enter for a new line</span>
              <ContextCounter controller={controller} />
              {generating ? (
                <button
                  type="button"
                  className="send-button stop"
                  aria-label="Stop response"
                  onClick={() => void cancel().catch((e) => setError(String(e)))}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send message"
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
