import { useEffect, useId, useRef, useState } from 'react';
import Feedback from '../../components/Feedback';
import { errorDetail } from '../../domain/errors';
import type { ProjectPassage } from '../../domain/types';
import { projectService } from '../../services/desktop';

export default function ProjectSourceDialog({
  source,
  onClose,
  attachmentText,
}: {
  source: ProjectPassage;
  onClose: () => void;
  attachmentText?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [file, setFile] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    if (!source.projectId) {
      setFile(
        attachmentText !== undefined
          ? { text: attachmentText }
          : { error: 'The file is no longer attached. The saved passage is kept.' },
      );
      return;
    }
    void projectService.fileText(source.projectId, source.fileId).then(
      (text) => {
        if (active) setFile({ text });
      },
      (error) => {
        if (active) setFile({ error: errorDetail(error).message });
      },
    );
    return () => {
      active = false;
    };
  }, [source, attachmentText]);
  return (
    <dialog
      ref={dialog}
      className="project-source-dialog"
      aria-labelledby={title}
      onClose={onClose}
    >
      <form method="dialog">
        <h2 id={title}>
          {source.name} · section {source.section}
        </h2>
        <button className="text-button" type="submit" autoFocus>
          Close
        </button>
      </form>
      <pre aria-label="Cited passage">{source.text}</pre>
      {file &&
        ('error' in file ? (
          <Feedback title="Couldn’t open the source file" details={file.error}>
            The saved passage is shown above.
          </Feedback>
        ) : (
          <details>
            <summary>Full file text</summary>
            <pre>{file.text}</pre>
          </details>
        ))}
      {!file && <p role="status">Opening source file…</p>}
    </dialog>
  );
}
