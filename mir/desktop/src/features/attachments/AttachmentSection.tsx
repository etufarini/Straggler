import {
  Download,
  FileText,
  FileType,
  FileSpreadsheet,
  FileSliders,
  FileCode,
  FileUp,
  X,
} from 'lucide-react';
import { useId } from 'react';
import Feedback from '../../components/Feedback';
import { fileName } from '../../domain/types';
import type { AttachmentController } from './useAttachments';

const icons = {
  txt: FileText,
  md: FileCode,
  docx: FileType,
  xlsx: FileSpreadsheet,
  pptx: FileSliders,
};
export default function AttachmentSection({ controller }: { controller: AttachmentController }) {
  const id = useId();
  const ready = controller.rows.filter((row) => row.state === 'ready').length;
  return (
    <section className="presence-section attachments-section" aria-labelledby={`${id}-title`}>
      <div className="presence-section-heading">
        <h2 id={`${id}-title`}>Attachments</h2>
        <span className="attachments-summary">
          {ready
            ? `${ready} ready · ${controller.approximate ? '~' : ''}${controller.tokens.toLocaleString('en-US')} tokens`
            : 'None'}
        </span>
      </div>
      {!!controller.rows.length && (
        <ul className="file-list">
          {controller.rows.map((row) => {
            const Icon = icons[row.extension as keyof typeof icons] ?? FileText;
            const tokens = row.attachment ? controller.estimate(row.attachment) : null;
            return (
              <li key={row.id} className={`file-row type-${row.extension} is-${row.state}`}>
                <span className="file-tile">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <div className="file-text">
                  <span
                    className="file-name"
                    title={`${row.name} · ${row.size === null ? 'Size unavailable' : `${row.size.toLocaleString('en-US')} bytes`}`}
                  >
                    {row.name}
                  </span>
                  <div className="file-meta">
                    <span className="file-ext">.{row.extension}</span>
                    {row.state === 'reading' ? (
                      <span role="status">Reading text…</span>
                    ) : row.state === 'error' ? (
                      <span className="file-error">{row.error}</span>
                    ) : (
                      <span>
                        {tokens?.source === 'approximate' ? '~' : ''}
                        {tokens?.tokens.toLocaleString('en-US')} tokens
                      </span>
                    )}
                  </div>
                </div>
                <div className="file-actions">
                  {row.state !== 'error' && (
                    <button
                      type="button"
                      className="file-action"
                      aria-label={`Download ${row.name}`}
                      title={`Download ${row.name}`}
                      disabled={row.state === 'reading'}
                      onClick={() => row.attachment && void controller.downloadFile(row.attachment)}
                    >
                      <Download size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="file-action"
                    aria-label={`Remove ${row.name}`}
                    title={`Remove ${row.name}`}
                    disabled={controller.disabled}
                    onClick={() => void controller.removeFile(row)}
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className={`dropzone ${controller.rows.length ? 'is-compact' : ''} ${controller.dragged.length ? 'is-dragover' : ''}`}
        aria-label="Choose files"
        aria-describedby={`${id}-hint${controller.disabled ? ` ${id}-busy` : ''}`}
        disabled={controller.disabled}
        onClick={() => void controller.chooseFiles()}
      >
        <span className="dropzone-icon">
          <FileUp size={18} aria-hidden="true" />
        </span>
        <span className="dropzone-text">
          <strong>
            {controller.dragged.length
              ? `Attach ${controller.dragged.length} ${controller.dragged.length === 1 ? 'file' : 'files'}`
              : controller.rows.length
                ? 'Add files'
                : 'Drop files here'}
          </strong>
          <span id={`${id}-hint`}>
            {controller.dragged.length
              ? controller.dragged.map(fileName).join(', ')
              : controller.rows.length
                ? 'Drop here or choose'
                : 'or choose files'}
          </span>
          {!controller.rows.length && (
            <small className="dropzone-types">.txt · .md · .docx · .xlsx · .pptx</small>
          )}
        </span>
      </button>
      {controller.disabled && (
        <p className="presence-note" id={`${id}-busy`}>
          Attachments can be changed when the response finishes.
        </p>
      )}
      {controller.error && (
        <Feedback
          title="Attachment action failed"
          details={controller.error}
          onDismiss={() => controller.setError('')}
        >
          {controller.error}
        </Feedback>
      )}
      {controller.notice && (
        <p className="success-message" role="status">
          {controller.notice}
        </p>
      )}
    </section>
  );
}
