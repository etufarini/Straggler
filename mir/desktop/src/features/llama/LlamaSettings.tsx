import type { SettingsController } from '../settings/useSettings';
import NumberField from '../../components/NumberField';
import { invoke } from '../../services/desktop';
import type { JobStatus } from '../../domain/types';

export default function LlamaSettings({ controller }: { controller: SettingsController }) {
  const {
    config,
    job,
    accept,
    confirm,
    onJob,
    busy,
    backend,
    setBackend,
    version,
    setVersion,
    tag,
    setTag,
    jobs,
    setJobs,
    native,
    active,
    building,
    run,
    operation,
    requestBuild,
  } = controller;
  return (
    <>
      <h2>llama.cpp</h2>
      <div className="build-summary">
        {config.build ? (
          <>
            <strong>
              {config.build.tag} · {config.build.backend}
            </strong>
            <code>{config.build.commit}</code>
          </>
        ) : (
          <p>
            {config.serverAvailable
              ? 'Using an external llama.cpp build.'
              : 'No llama.cpp build configured. Install one below or select an existing folder.'}
          </p>
        )}
      </div>
      <div className="field-grid">
        <label className="setting-field">
          <span>Build backend</span>
          <select
            value={backend}
            disabled={building}
            onChange={(event) => setBackend(event.target.value)}
          >
            {config.backends.map((value) => (
              <option key={value.id} value={value.id}>
                {value.label}
              </option>
            ))}
          </select>
          <small>GPU builds require working drivers. CPU remains available in GPU builds.</small>
        </label>
        <NumberField
          label="Compiler jobs"
          value={jobs}
          onChange={setJobs}
          disabled={building}
          hint="1–64 compiler jobs. This is separate from inference CPU threads."
        />
      </div>
      <label className="setting-field">
        <span>Source version</span>
        <select
          disabled={building}
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        >
          <option value="latest">Latest published release</option>
          <option value="tag">Specific release tag</option>
        </select>
      </label>
      {version === 'tag' && (
        <label className="setting-field">
          <span>Release tag</span>
          <input
            value={tag}
            disabled={building}
            onChange={(event) => setTag(event.target.value)}
            placeholder="Official release tag"
          />
        </label>
      )}
      <div className="row-actions">
        <button
          className="primary-button"
          disabled={busy || building || active || !native}
          onClick={() => void requestBuild()}
        >
          Install / change build
        </button>
        <button
          disabled={busy || building || active || !config.build || !native}
          onClick={() => void requestBuild(true)}
        >
          Check for updates
        </button>
        <button
          disabled={busy || building || active || !config.build?.previous || !native}
          onClick={() =>
            confirm({
              title: 'Restore previous build?',
              text: 'Switch to the previous verified llama.cpp build? Model settings and conversations will be kept.',
              action: async () => {
                accept(await operation('restore'));
              },
            })
          }
        >
          Restore previous build
        </button>
      </div>
      <p role="status" className="job-status">
        Build status: {job.phase}
        {job.error ? ` · ${job.error}` : ''}
      </p>
      {building && (
        <button
          className="danger-button"
          onClick={() =>
            confirm({
              title: 'Cancel build?',
              text: 'Stop the current build and keep the working installation?',
              action: async () => {
                await invoke('cancel_build');
                onJob(await invoke<JobStatus>('job_status'));
              },
            })
          }
        >
          Cancel build
        </button>
      )}
      <button
        className="text-button"
        disabled={busy || !native}
        onClick={() =>
          void run(async () => {
            const value = await invoke<{ logs: string[] }>('workspace_action', {
              action: 'build-log',
              arguments: [],
              targets: [],
            });
            onJob({ ...job, logs: value.logs });
          })
        }
      >
        View build log
      </button>
      <pre className="build-log" tabIndex={0}>
        {job.logs.join('\n') || 'Build output appears here.'}
      </pre>
    </>
  );
}
