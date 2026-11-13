import ReasoningControls from '../../components/ReasoningControls';
import { useId } from 'react';
import type { SettingsController } from './useSettings';

export default function ChatDefaults({ controller }: { controller: SettingsController }) {
  const id = useId();
  const { draft, change, fieldError } = controller;
  return (
    <section className="chat-defaults" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Chat defaults</h3>
      <p className="field-help">
        New chats start with these. You can change them for one chat from the message box, without
        restarting the server.
      </p>
      <label className="setting-field">
        <span>Default system prompt</span>
        <textarea
          className="settings-textarea"
          aria-label="Default system prompt"
          rows={4}
          value={draft.chat_system_prompt}
          onChange={(event) => change('chat_system_prompt', event.target.value)}
        />
        <small>
          Instructions the assistant follows in every new chat. Leave empty to use the model’s
          default.
        </small>
        {fieldError('chat_system_prompt') && (
          <span className="field-error" role="alert">
            {fieldError('chat_system_prompt')}
          </span>
        )}
      </label>
      <ReasoningControls
        reasoning={draft.chat_reasoning}
        effort={draft.chat_reasoning_effort}
        details={controller.server.model === draft.model ? controller.serverDetails : null}
        onReasoning={(value) => change('chat_reasoning', value)}
        onEffort={(value) => change('chat_reasoning_effort', value)}
      />
    </section>
  );
}
