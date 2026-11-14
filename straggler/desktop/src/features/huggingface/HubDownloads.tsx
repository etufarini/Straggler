import { formatBytes } from '../../domain/huggingFace';
import type { HuggingFaceController } from './useHuggingFace';

export default function HubDownloads({ controller }: { controller: HuggingFaceController }) {
  const downloads = controller.downloads.filter((download) => download.phase !== 'cancelled');
  if (!downloads.length) return null;
  return (
    <section aria-label="Model downloads" className="hf-downloads">
      <h3>Downloads</h3>
      {downloads.map((download) => (
        <article
          key={download.id}
          className={`hf-download${download.phase === 'paused' ? ' is-paused' : ''}`}
        >
          <div className="hf-download-head">
            <strong>{download.plan.repository}</strong>
            <span>{download.phase}</span>
          </div>
          <progress
            aria-label={`Download ${download.plan.repository}`}
            value={download.downloaded}
            max={download.total || 1}
          />
          <p className="hf-path-hint">
            {formatBytes(download.downloaded)} of {formatBytes(download.total)} ·{' '}
            {download.plan.files.length} files
          </p>
          <p className="hf-path-hint">{download.root}</p>
          {download.error && (
            <p role="alert" className="hf-callout error">
              {download.error}
            </p>
          )}
          <div className="row-actions">
            {['downloading', 'verifying'].includes(download.phase) && (
              <button
                disabled={controller.busy}
                onClick={() => void controller.control(download.id, 'pause')}
              >
                Pause
              </button>
            )}
            {['paused', 'error'].includes(download.phase) && (
              <button
                disabled={controller.busy}
                onClick={() => void controller.control(download.id, 'resume')}
              >
                Resume
              </button>
            )}
            {download.phase !== 'completed' && (
              <button
                disabled={controller.busy || ['pausing', 'cancelling'].includes(download.phase)}
                onClick={() => void controller.control(download.id, 'cancel')}
              >
                Cancel download
              </button>
            )}
            {download.phase === 'completed' && (
              <span className="success-message">SHA-256 verified. Available on this computer.</span>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
