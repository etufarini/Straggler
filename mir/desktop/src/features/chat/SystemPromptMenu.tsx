import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import Popover from '../../components/Popover';
import type { WorkspaceController } from '../../app/useWorkspace';

function SystemPromptEditor({
  controller,
  close,
}: {
  controller: WorkspaceController;
  close: () => void;
}) {
  const { chat, config, setChatOptions, reviewSettings } = controller;
  const [source, setSource] = useState(
    chat.options?.systemPrompt === undefined || chat.options?.systemPrompt === null
      ? 'default'
      : 'chat',
  );
  const [text, setText] = useState(
    chat.options?.systemPrompt ?? config?.settings.chat_system_prompt ?? '',
  );
  const tooLong = new TextEncoder().encode(text).length > 65536 || text.includes('\0');
  return (
    <>
      <p className="popover-note">
        Instructions the assistant follows in this chat. Applies from your next message.
      </p>
      <fieldset className="choice-group">
        <legend>Source</legend>
        <div className="segmented">
          <label>
            <input
              type="radio"
              name="system-source"
              checked={source === 'default'}
              onChange={() => setSource('default')}
            />
            <span>
              Default<small>From Settings</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="system-source"
              checked={source === 'chat'}
              onChange={() => setSource('chat')}
            />
            <span>
              This chat<small>Custom text</small>
            </span>
          </label>
        </div>
      </fieldset>
      <textarea
        className="instructions-input"
        aria-label="System prompt instructions"
        value={source === 'default' ? (config?.settings.chat_system_prompt ?? '') : text}
        readOnly={source === 'default'}
        rows={5}
        placeholder="Use the model’s default"
        onChange={(event) => setText(event.target.value)}
      />
      {source === 'chat' && tooLong && (
        <p className="field-error" role="alert">
          Use at most 65536 UTF-8 bytes without NUL characters.
        </p>
      )}
      <div className="popover-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            close();
            reviewSettings('model');
          }}
        >
          Edit default
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={source === 'chat' && tooLong}
          onClick={() => {
            setChatOptions({ systemPrompt: source === 'default' ? null : text });
            close();
          }}
        >
          Apply to this chat
        </button>
      </div>
    </>
  );
}

export default function SystemPromptMenu({ controller }: { controller: WorkspaceController }) {
  return (
    <Popover
      label="System prompt"
      valueLabel={
        controller.chat.options?.systemPrompt == null
          ? 'From Settings'
          : 'Custom instructions for this chat'
      }
      disabled={controller.generating}
      className="system-menu"
      trigger={
        <>
          <FileText size={14} />
          <span>System prompt</span>
          <span className="chip-value">
            {controller.chat.options?.systemPrompt == null ? 'Default' : 'This chat'}
          </span>
          <ChevronDown size={12} />
        </>
      }
    >
      {(close) => <SystemPromptEditor controller={controller} close={close} />}
    </Popover>
  );
}
