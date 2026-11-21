import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmationFrame } from '../../app/ConfirmationDialog';
import { containTabFocus } from '../../components/focus';
import Feedback from '../../components/Feedback';
import Select from '../../components/Select';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import { availablePresetName, systemPromptError } from '../../domain/systemPrompts';
import type { PresetText, SystemPromptPreset } from '../../domain/systemPrompts';

interface PresetsController {
  presets: SystemPromptPreset[];
  ready: boolean;
  error: string;
  reload: () => Promise<void>;
  save: (preset: PresetText, id?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importPresets: (choices: { preset: PresetText; replace: boolean }[]) => Promise<void>;
  edit: (preset?: PresetText, id?: string) => void;
}
const PresetsContext = createContext<PresetsController | null>(null);
export function usePromptPresets() {
  const value = useContext(PresetsContext);
  if (!value) throw new Error('Prompt presets require their application provider.');
  return value;
}

export function PromptPresetsProvider({ children }: { children: ReactNode }) {
  const [presets, setPresets] = useState<SystemPromptPreset[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ preset: PresetText; id?: string } | null>(null);
  async function reload() {
    try {
      setPresets(await invoke<SystemPromptPreset[]>('system_prompts_list'));
      setReady(true);
      setError('');
    } catch (failure) {
      setReady(false);
      setError(errorDetail(failure).message);
    }
  }
  useEffect(() => {
    if (isTauri()) void reload();
  }, []);
  const controller: PresetsController = {
    presets,
    ready,
    error,
    reload,
    async save(preset, id) {
      setPresets(
        await invoke<SystemPromptPreset[]>('system_prompt_save', { id: id ?? null, preset }),
      );
      setNotice('Preset saved.');
    },
    async remove(id) {
      setPresets(await invoke<SystemPromptPreset[]>('system_prompt_delete', { id }));
      setNotice('Preset deleted.');
    },
    async importPresets(choices) {
      setPresets(await invoke<SystemPromptPreset[]>('system_prompts_import', { choices }));
      setNotice('Presets imported.');
    },
    edit(preset, id) {
      setEditor({
        preset: preset ?? {
          name: availablePresetName('New prompt', presets),
          description: '',
          prompt: '',
        },
        id,
      });
    },
  };
  return (
    <PresetsContext.Provider value={controller}>
      {children}
      <span role="status" className="visually-hidden">
        {notice}
      </span>
      {editor &&
        createPortal(
          <PresetEditor
            key={editor.id ?? editor.preset.name}
            preset={editor.preset}
            id={editor.id}
            controller={controller}
            close={() => setEditor(null)}
          />,
          document.body,
        )}
    </PresetsContext.Provider>
  );
}

export function PresetDialogFocus({ close, children }: { close: () => void; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLElement>('[data-initial-focus], input, button')?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (document.activeElement?.matches('[role="combobox"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose.current();
      } else containTabFocus(event, container.current);
    }
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return <div ref={container}>{children}</div>;
}

function PresetEditor({
  preset,
  id,
  controller,
  close,
}: {
  preset: PresetText;
  id?: string;
  controller: PresetsController;
  close: () => void;
}) {
  const [value, setValue] = useState(preset);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [saved, setSaved] = useState(false);
  const name = value.name.trim();
  const invalidName = !name || Array.from(name).length > 80 || name.includes('\0');
  const duplicate = controller.presets.some(
    (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase(),
  );
  const promptError = systemPromptError(value.prompt);
  async function save() {
    setSaved(true);
    if (invalidName || duplicate || promptError || Array.from(value.description).length > 200)
      return;
    setBusy(true);
    try {
      await controller.save({ ...value, name }, id);
      close();
    } catch (error) {
      setFailure(errorDetail(error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PresetDialogFocus
      close={() => {
        if (!busy) close();
      }}
    >
      <ConfirmationFrame
        role="dialog"
        project
        title={id ? 'Edit preset' : 'New preset'}
        busy={busy}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="setting-field">
            <span>Name</span>
            <input
              data-initial-focus
              value={value.name}
              disabled={busy}
              onChange={(event) => setValue({ ...value, name: event.target.value })}
            />
            {saved && (invalidName || duplicate) && (
              <span className="field-error" role="alert">
                {duplicate
                  ? 'A preset with this name already exists.'
                  : 'Use a name of 1–80 characters.'}
              </span>
            )}
          </label>
          <label className="setting-field">
            <span>Description (optional)</span>
            <textarea
              className="settings-textarea"
              rows={2}
              maxLength={200}
              value={value.description}
              disabled={busy}
              onChange={(event) => setValue({ ...value, description: event.target.value })}
            />
          </label>
          <label className="setting-field">
            <span>System prompt</span>
            <textarea
              className="settings-textarea"
              rows={6}
              value={value.prompt}
              disabled={busy}
              onChange={(event) => setValue({ ...value, prompt: event.target.value })}
            />
            {promptError && (
              <span className="field-error" role="alert">
                {promptError}
              </span>
            )}
          </label>
          {failure && (
            <Feedback title="Couldn’t save the preset" details={failure}>
              Your edits remain available. Try again.
            </Feedback>
          )}
          <div className="panel-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy || !!promptError}>
              {busy ? 'Saving…' : 'Save preset'}
            </button>
          </div>
        </form>
      </ConfirmationFrame>
    </PresetDialogFocus>
  );
}

export function InsertPreset({
  onInsert,
  disabled = false,
}: {
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const { presets, ready, error } = usePromptPresets();
  return (
    <div className="insert-preset">
      <Select
        aria-label="Insert preset"
        value=""
        disabled={disabled || !ready || !presets.length}
        options={[
          { value: '', label: 'Insert preset' },
          ...presets.map((p) => ({ value: p.id, label: p.name })),
        ]}
        onChange={(id) => {
          const preset = presets.find((p) => p.id === id);
          if (preset) onInsert(preset.prompt);
        }}
      />
      {error && (
        <p className="field-error" role="alert">
          Couldn’t load presets. {error}
        </p>
      )}
    </div>
  );
}
