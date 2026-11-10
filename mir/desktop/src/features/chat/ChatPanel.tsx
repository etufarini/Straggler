import ReasoningMenu from './ReasoningMenu';
import SystemPromptMenu from './SystemPromptMenu';
import ContextCounter from './ContextCounter';
import Markdown from './Markdown';
import { ArrowUp, HardDrive, LoaderCircle, Check, Copy, Square } from 'lucide-react';
import { fileName } from '../../domain/types';
import { messageStatusLabel } from '../../components/statusLabels';
import Feedback from '../../components/Feedback';
import StorageFeedback from './StorageFeedback';
import type { WorkspaceController } from '../../app/useWorkspace';
import { useEffect, useRef, useState } from 'react';
import { errorDetail } from '../../domain/errors';
export default function ChatPanel({ controller }: { controller: WorkspaceController }) {
  const [copied, setCopied] = useState('');
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
                      <span>{chat.model ? fileName(chat.model) : 'Local model'}</span>
                    )}
                  </div>
                  {message.reasoning && (
                    <details className="reasoning">
                      <summary>Reasoning</summary>
                      <Markdown>{message.reasoning}</Markdown>
                    </details>
                  )}
                  <div className="markdown">
                    <Markdown>{message.content}</Markdown>
                  </div>
                  {message.status === 'streaming' && (
                    <span className="typing-indicator">
                      <LoaderCircle size={14} className="spin" />{' '}
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
                  {message.role === 'assistant' &&
                    message.content &&
                    message.status !== 'streaming' && (
                      <button
                        className="copy-button"
                        aria-label="Copy response"
                        onClick={async () => {
                          setCopyError(null);
                          try {
                            await navigator.clipboard.writeText(message.content);
                            setCopied(message.id);
                            setTimeout(() => setCopied(''), 1600);
                          } catch (e) {
                            setCopyError({ messageId: message.id, detail: errorDetail(e).message });
                          }
                        }}
                      >
                        {copied === message.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
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
