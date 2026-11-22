import Select from '../../components/Select';
import { systemPromptError, availablePresetName } from '../../domain/systemPrompts';
import { InsertPreset, usePromptPresets } from '../prompts/PromptPresets';
import { countLabel } from '../../domain/text';
import { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import Popover from '../../components/Popover';
import type { WorkspaceController } from '../../app/useWorkspace';
import { ownSystemPrompt } from '../../domain/projects';
import { estimateProjectTokens } from '../../domain/projectContext';
import Feedback from '../../components/Feedback';
import { errorDetail } from '../../domain/errors';

function SystemPromptEditor({
  controller,
  close,
}: {
  controller: WorkspaceController;
  close: () => void;
}) {
  const { chat, config, setChatOptions, reviewSettings } = controller;
  const [source, setSource] = useState(ownSystemPrompt(chat) === null ? 'default' : 'chat');
  const [text, setText] = useState(
    ownSystemPrompt(chat) ?? config?.settings.chat_system_prompt ?? '',
  );
  const { presets, ready, error, edit } = usePromptPresets();
  const [selectedPreset, setSelectedPreset] = useState('');
  const selected = presets.find((preset) => preset.id === selectedPreset);
  const matching = presets.find((preset) => preset.prompt === text);
  const tooLong = systemPromptError(text);
  return (
    <>
      <p className="popover-note">
        Instructions the assistant follows in this chat. Changes apply from the next message.
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
      {source === 'chat' && (
        <label className="setting-field">
          <span>Preset</span>
          <Select
            aria-label="Preset"
            value={selectedPreset}
            disabled={!ready}
            options={[
              { value: '', label: 'None' },
              ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
            ]}
            onChange={(id) => {
              setSelectedPreset(id);
              const preset = presets.find((preset) => preset.id === id);
              if (preset) setText(preset.prompt);
            }}
          />
        </label>
      )}
      {error && (
        <p className="field-error" role="alert">
          Couldn’t load presets. {error}
        </p>
      )}
      <textarea
        className="instructions-input"
        aria-label="System prompt instructions"
        value={source === 'default' ? (config?.settings.chat_system_prompt ?? '') : text}
        readOnly={source === 'default'}
        rows={5}
        placeholder="Use the model’s default"
        onChange={(event) => setText(event.target.value)}
      />
      {source === 'chat' && (matching || selected) && (
        <p className="popover-note">
          {matching ? `From preset ‘${matching.name}’` : `Edited from ‘${selected!.name}’`}
        </p>
      )}
      {source === 'chat' && tooLong && (
        <p className="field-error" role="alert">
          {tooLong}
        </p>
      )}
      <div className="popover-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            close();
            reviewSettings('chat-defaults');
          }}
        >
          Edit default
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!ready || !!tooLong}
          onClick={() => {
            edit({
              name: availablePresetName(selected?.name ?? 'Chat prompt', presets),
              description: '',
              prompt: source === 'default' ? (config?.settings.chat_system_prompt ?? '') : text,
            });
            close();
          }}
        >
          Save as preset…
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={controller.chatOptionsDisabled || (source === 'chat' && !!tooLong)}
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
  const project = controller.currentProject;
  return (
    <Popover
      label={project ? 'System prompt: Project instructions' : 'System prompt'}
      heading={project ? 'Project instructions' : undefined}
      controlId="button-system-prompt"
      closeControlId={project ? 'button-close-project-instructions' : undefined}
      containFocus={!!project}
      popoverClassName={project ? 'is-project' : ''}
      valueLabel={
        project
          ? `From project ${project.name}`
          : ownSystemPrompt(controller.chat) === null
            ? 'From Settings'
            : 'Custom instructions for this chat'
      }
      disabled={project ? !controller.projects.ready : controller.chatOptionsDisabled}
      className={`system-menu${project ? ' is-project' : ''}`}
      trigger={
        <>
          <FileText size={14} />
          <span>System prompt</span>
          <span className="chip-value">
            {project
              ? 'Project instructions'
              : ownSystemPrompt(controller.chat) === null
                ? 'Default'
                : 'This chat'}
          </span>
          <ChevronDown size={12} />
        </>
      }
    >
      {(close) =>
        project ? (
          <ProjectInstructionsEditor controller={controller} close={close} />
        ) : (
          <SystemPromptEditor controller={controller} close={close} />
        )
      }
    </Popover>
  );
}

function ProjectInstructionsEditor({
  controller,
  close,
}: {
  controller: WorkspaceController;
  close: () => void;
}) {
  const project = controller.currentProject!;
  const count = controller.conversations.filter((chat) => chat.projectId === project.id).length;
  const [text, setText] = useState(project.instructions);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  async function saveInstructions() {
    setBusy(true);
    try {
      await controller.projects.update(project.id, { instructions: text });
      controller.projects.setNotice({
        message: text.trim()
          ? `Saved the project instructions for ${countLabel(count, 'chat')}.`
          : 'Cleared the project instructions. This project uses the system prompt from Settings.',
      });
      close();
    } catch (error) {
      setFailure(errorDetail(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="popover-note">
        From <strong>{project.name}</strong>.{' '}
        {project.archived
          ? 'The project is archived, so its instructions are read-only.'
          : `Changes apply to all ${countLabel(count, 'chat')} in this project and replace the system prompt from Settings.`}
      </p>
      {ownSystemPrompt(controller.chat) !== null && (
        <p className="popover-note">
          This chat’s own prompt is kept and returns if the chat leaves the project.
        </p>
      )}
      {!project.archived && <InsertPreset disabled={busy} onInsert={setText} />}
      <textarea
        className="instructions-input"
        data-initial-focus
        data-control-id="textarea-project-instructions"
        aria-label="Project instructions"
        rows={6}
        value={text}
        readOnly={project.archived}
        aria-describedby="project-prompt-count"
        onChange={(event) => setText(event.target.value)}
      />
      <p className="popover-note project-count" id="project-prompt-count">
        ≈ {estimateProjectTokens(text).toLocaleString('en-US')} tokens · estimate while editing
      </p>
      {controller.generating && (
        <p className="popover-note">Changes apply from the next message.</p>
      )}
      {failure && (
        <Feedback title="Couldn’t save the instructions" details={failure}>
          Your edits are kept. Try again.
        </Feedback>
      )}
      <div className="popover-actions">
        <button
          className="text-button"
          data-control-id="button-open-project-from-prompt"
          onClick={() => {
            close();
            controller.openProject(project.id);
          }}
        >
          Open project
        </button>
        {!project.archived && (
          <button
            className="primary-button"
            data-control-id="button-save-instructions-for-chats"
            disabled={busy}
            onClick={() => void saveInstructions()}
          >
            Save for {count} {count === 1 ? 'chat' : 'chats'}
          </button>
        )}
      </div>
    </>
  );
}
