import { FileText, FileType, FileSpreadsheet, FileChartColumn, FileCode } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AttachmentRow as Row } from '../../domain/attachments';
import type { TokenEstimate } from '../../services/desktop';

const icons = {
  txt: FileText,
  md: FileCode,
  docx: FileType,
  xlsx: FileSpreadsheet,
  pptx: FileChartColumn,
  pdf: FileText,
};

export default function AttachmentRow({
  row,
  estimate,
  excluded = false,
  project = false,
  projectSearch = false,
  searched = false,
  visionSupported = false,
  children,
}: {
  row: Row;
  estimate?: TokenEstimate | null;
  excluded?: boolean;
  project?: boolean;
  projectSearch?: boolean;
  searched?: boolean;
  visionSupported?: boolean;
  children: ReactNode;
}) {
  const Icon = icons[row.extension as keyof typeof icons] ?? FileText;
  return (
    <li
      className={`file-row type-${row.extension} is-${row.state}${excluded ? ' is-excluded' : ''}`}
    >
      <span className="file-tile">
        {row.attachment?.image ? (
          <img
            className="file-thumb"
            src={row.attachment.image.thumbnail}
            alt=""
            width={30}
            height={30}
          />
        ) : (
          <Icon size={17} aria-hidden="true" />
        )}
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
            <span className="file-error" role="alert">
              {row.error}
            </span>
          ) : row.attachment?.image ? (
            <span role="status">
              {!visionSupported
                ? 'This model can’t read images. It won’t be sent.'
                : row.attachment.image.resized
                  ? 'Resized to 2,048 px'
                  : 'Image ready'}
            </span>
          ) : (
            <>
              <span>
                {estimate?.source === 'approximate' ? (project ? '≈ ' : '~') : ''}
                {estimate?.tokens.toLocaleString('en-US')} tokens
              </span>
              {!project && <span>{searched ? 'Searched' : 'In context'}</span>}
              {project && (
                <span>
                  {excluded ? 'Excluded' : projectSearch ? 'In project search' : 'In context'}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className={project ? 'project-file-actions' : 'file-actions'}>{children}</div>
    </li>
  );
}
