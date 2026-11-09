import { useEffect, useRef, useState } from 'react';
import { invoke } from '../services/desktop';
import { ArrowUp, Folder, X } from 'lucide-react';
import Feedback from './Feedback';

interface Directory {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
}

export default function FolderBrowser({
  initial,
  onSelect,
  onClose,
}: {
  initial: string;
  onSelect: (path: string) => Promise<void>;
  onClose: () => void;
}) {
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [typed, setTyped] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const request = useRef(0);

  async function open(path: string, showHidden = hidden) {
    const id = ++request.current;
    setBusy(true);
    setError('');
    try {
      const value = await invoke<Directory>('workspace_action', {
        action: 'browse',
        arguments: [path, String(showHidden)],
        targets: [],
      });
      if (id === request.current) {
        setDirectory(value);
        setTyped(value.path);
      }
    } catch (e) {
      if (id === request.current) setError(String(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }

  useEffect(() => {
    void open(initial);
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      request.current++;
      previous?.focus();
    };
  }, []);

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialog}
        className="folder-browser"
        role="dialog"
        aria-modal="true"
        aria-label="Choose folder"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !committing) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const nodes = dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            );
            if (!nodes?.length) return;
            const first = nodes[0],
              last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="panel-heading">
          <h2>Choose folder</h2>
          <button aria-label="Cancel folder selection" disabled={committing} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form
          className="path-entry"
          onSubmit={(event) => {
            event.preventDefault();
            void open(typed);
          }}
        >
          <input
            aria-label="Folder path"
            disabled={committing}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            Open
          </button>
        </form>
        <div className="folder-tools">
          <button
            disabled={busy || !directory}
            onClick={() => directory && void open(directory.parent)}
          >
            <ArrowUp size={14} />
            Parent folder
          </button>
          <label>
            <input
              type="checkbox"
              disabled={committing}
              checked={hidden}
              onChange={(event) => {
                setHidden(event.target.checked);
                void open(directory?.path || typed, event.target.checked);
              }}
            />
            Show hidden folders
          </label>
        </div>
        <p className="field-help">
          Select a folder to open it. Use this folder confirms the current location; Cancel keeps
          your previous setting.
        </p>
        {error && (
          <Feedback title="Folder unavailable" details={error}>
            Choose a readable folder or enter another path. Your previous setting has been kept.
          </Feedback>
        )}
        <div className="directory-list">
          {busy ? (
            <p>Loading folders…</p>
          ) : (
            directory?.directories.map((folder) => (
              <button key={folder.path} onClick={() => void open(folder.path)}>
                <Folder size={17} />
                <span>{folder.name}</span>
              </button>
            ))
          )}
          {!busy && directory?.directories.length === 0 && <p>No subfolders.</p>}
        </div>
        <div className="panel-actions">
          <button disabled={committing} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!directory || busy}
            onClick={async () => {
              if (!directory) return;
              setBusy(true);
              setCommitting(true);
              try {
                await onSelect(directory.path);
                onClose();
              } catch (e) {
                setError(String(e));
                setBusy(false);
                setCommitting(false);
              }
            }}
          >
            Use this folder
          </button>
        </div>
      </section>
    </div>
  );
}
