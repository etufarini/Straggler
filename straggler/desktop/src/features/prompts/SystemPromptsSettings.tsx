import { useState } from 'react';
import { Copy, Download, Pencil, Trash2 } from 'lucide-react';
import ActionMenu from '../../components/ActionMenu';
import Select from '../../components/Select';
import Feedback from '../../components/Feedback';
import { ConfirmationFrame } from '../../app/ConfirmationDialog';
import type { Confirmation } from '../../domain/types';
import type { PresetText, SystemPromptPreset } from '../../domain/systemPrompts';
import { availablePresetName } from '../../domain/systemPrompts';
import { errorDetail } from '../../domain/errors';
import { choosePromptImport, exportPromptPresets } from '../../services/desktop';
import { PresetDialogFocus, usePromptPresets } from './PromptPresets';

export default function SystemPromptsSettings({
  confirm,
}: {
  confirm: (value: Confirmation) => void;
}) {
  const controller = usePromptPresets();
  const { presets, ready, error } = controller;
  const [failure, setFailure] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<PresetText[] | null>(null);
  async function perform(action: () => Promise<void>) {
    setFailure('');
    try {
      await action();
    } catch (error) {
      setFailure(errorDetail(error).message);
    }
  }
  async function exportPresets(values: SystemPromptPreset[]) {
    if (await exportPromptPresets(values)) setNotice('Presets exported.');
  }
  return (
    <>
      <h2>System prompts</h2>
      <p className="field-help">Changes are saved automatically.</p>
      <div className="preset-toolbar">
        <button className="primary-button" disabled={!ready} onClick={() => controller.edit()}>
          New preset
        </button>
        <button
          disabled={!ready}
          onClick={() =>
            void perform(async () => {
              const values = await choosePromptImport();
              if (values) setPreview(values);
            })
          }
        >
          Import…
        </button>
        <button
          disabled={!ready || !presets.length}
          onClick={() => void perform(() => exportPresets(presets))}
        >
          Export all…
        </button>
      </div>
      {(error || failure) && (
        <Feedback title="Couldn’t update system prompts" details={error || failure}>
          Your saved presets are kept.{' '}
          <button onClick={() => void controller.reload()}>Reload presets</button>
        </Feedback>
      )}
      {notice && (
        <p role="status" className="success-message">
          {notice}
        </p>
      )}
      {ready && !presets.length && (
        <p className="field-help">Save prompts you use often and reuse them in any chat.</p>
      )}
      <ul className="preset-list" aria-label="System prompt presets">
        {presets.map((preset) => (
          <li key={preset.id} className="preset-card">
            <div>
              <h3>{preset.name}</h3>
              {preset.description && <p>{preset.description}</p>}
              <p className="preset-preview">{preset.prompt.split('\n')[0] || 'Empty prompt'}</p>
            </div>
            <ActionMenu
              label={`Options for ${preset.name}`}
              title="Preset options"
              controlId={`preset-options-${preset.id}`}
              items={[
                {
                  label: 'Edit',
                  icon: <Pencil size={14} />,
                  controlId: 'preset-edit',
                  onSelect: () => controller.edit(preset, preset.id),
                },
                {
                  label: 'Duplicate',
                  icon: <Copy size={14} />,
                  controlId: 'preset-duplicate',
                  onSelect: () =>
                    void perform(() =>
                      controller.save({
                        ...preset,
                        name: availablePresetName(preset.name, presets),
                      }),
                    ),
                },
                {
                  label: 'Export…',
                  icon: <Download size={14} />,
                  controlId: 'preset-export',
                  onSelect: () => void perform(() => exportPresets([preset])),
                },
                {
                  label: 'Delete',
                  icon: <Trash2 size={14} />,
                  controlId: 'preset-delete',
                  destructive: true,
                  onSelect: () =>
                    confirm({
                      title: `Delete “${preset.name}”?`,
                      text: 'Chats and projects that used this preset keep their copied instructions.',
                      actionLabel: 'Delete preset',
                      destructive: true,
                      action: () => controller.remove(preset.id),
                    }),
                },
              ]}
            />
          </li>
        ))}
      </ul>
      {preview && (
        <ImportPreview
          presets={preview}
          close={() => setPreview(null)}
          imported={() => setNotice('Presets imported.')}
        />
      )}
    </>
  );
}

function ImportPreview({
  presets,
  close,
  imported,
}: {
  presets: PresetText[];
  close: () => void;
  imported: () => void;
}) {
  const controller = usePromptPresets();
  const [choices, setChoices] = useState(
    presets.map((preset) => ({ preset, selected: true, replace: false })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function accept() {
    setBusy(true);
    try {
      await controller.importPresets(
        choices
          .filter((choice) => choice.selected)
          .map(({ preset, replace }) => ({ preset, replace })),
      );
      imported();
      close();
    } catch (error) {
      setError(errorDetail(error).message);
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
      <ConfirmationFrame project role="dialog" title="Import system prompts" busy={busy}>
        <p>Choose which presets to import. Only the system prompt is imported.</p>
        <div className="preset-import-list">
          {choices.map((choice, index) => {
            const conflict =
              controller.presets.some(
                (p) => p.name.toLowerCase() === choice.preset.name.toLowerCase(),
              ) ||
              choices
                .slice(0, index)
                .some(
                  (p) =>
                    p.selected && p.preset.name.toLowerCase() === choice.preset.name.toLowerCase(),
                );
            return (
              <section key={index}>
                <label>
                  <input
                    type="checkbox"
                    checked={choice.selected}
                    disabled={busy}
                    onChange={(event) =>
                      setChoices((values) =>
                        values.map((v, i) =>
                          i === index ? { ...v, selected: event.target.checked } : v,
                        ),
                      )
                    }
                  />{' '}
                  {choice.preset.name}
                </label>
                {choice.preset.description && <p>{choice.preset.description}</p>}
                <pre>{choice.preset.prompt || 'Empty prompt'}</pre>
                {conflict && (
                  <label className="setting-field">
                    <span>A preset with this name already exists</span>
                    <Select
                      aria-label={`Name conflict for ${choice.preset.name}`}
                      disabled={busy || !choice.selected}
                      value={choice.replace ? 'replace' : 'keep'}
                      options={[
                        { value: 'keep', label: 'Keep both' },
                        { value: 'replace', label: 'Replace' },
                      ]}
                      onChange={(value) =>
                        setChoices((values) =>
                          values.map((v, i) =>
                            i === index ? { ...v, replace: value === 'replace' } : v,
                          ),
                        )
                      }
                    />
                  </label>
                )}
              </section>
            );
          })}
        </div>
        {error && (
          <Feedback title="Couldn’t import presets" details={error}>
            Your saved presets are kept. Review the file and try again.
          </Feedback>
        )}
        <div className="panel-actions">
          <button disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !choices.some((c) => c.selected)}
            onClick={() => void accept()}
          >
            Import selected
          </button>
        </div>
      </ConfirmationFrame>
    </PresetDialogFocus>
  );
}
