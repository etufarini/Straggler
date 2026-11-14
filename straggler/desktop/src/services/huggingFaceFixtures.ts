import type { HubDownload, HubFile, HubRepository } from '../domain/huggingFace';
import type { Configuration, Model } from '../domain/types';

// Development-only Hub responses; native HTTP, digest and resume contracts have Rust tests.
export function createHuggingFaceFixture(
  configuration: () => Configuration,
  addModel: (model: Model) => void,
) {
  let token: string | null = null;
  let current: HubRepository | null = null;
  const jobs: HubDownload[] = [];
  const file = (path: string, size = 8 * 1024 ** 2): HubFile => ({
    path,
    size,
    sha256: 'a'.repeat(64),
  });
  const files = [
    file('model.gguf'),
    file('split-00001-of-00002.gguf', 4 * 1024 ** 2),
    file('split-00002-of-00002.gguf', 4 * 1024 ** 2),
    file('mmproj.gguf', 1024 ** 2),
  ];
  function request(kind: string) {
    window.dispatchEvent(new CustomEvent('straggler-fixture-hf-request', { detail: kind }));
  }
  function repository(id: string): HubRepository {
    return {
      id,
      revision: 'b'.repeat(40),
      files,
      gated: id.includes('gated'),
      warning: null,
      suggestedFile: null,
      variants: [
        { path: files[0].path, label: files[0].path, size: files[0].size, parts: 1, error: null },
        {
          path: files[1].path,
          label: files[1].path,
          size: files[1].size + files[2].size,
          parts: 2,
          error: null,
        },
        { path: files[3].path, label: files[3].path, size: files[3].size, parts: 1, error: null },
      ],
    };
  }
  return {
    async invoke(command: string, args: Record<string, unknown>) {
      switch (command) {
        case 'hf_token_status':
          return { saved: token !== null, available: true, error: null };
        case 'hf_token_save':
          token = args.token === null ? null : String(args.token);
          return { saved: token !== null, available: true, error: null };
        case 'models_folder_info':
          return {
            path: configuration().modelsDir,
            defaultPath: '/fixture/app-data/io.github.etufarini.straggler/models',
            freeBytes: localStorage.getItem('straggler-fixture-hf-low-disk') ? 3 : 32 * 1024 ** 3,
            error: null,
          };
        case 'hf_search': {
          request('search');
          const query = String(args.query);
          if (localStorage.getItem('straggler-fixture-hf-offline'))
            throw new Error('Cannot connect to Hugging Face. Check the connection and retry.');
          if (query.includes('/')) {
            const id = query
              .replace('https://huggingface.co/', '')
              .split('/')
              .slice(0, 2)
              .join('/');
            current = repository(id);
            return { repositories: [], direct: current, warning: null };
          }
          return {
            repositories: [
              {
                id: query.includes('gated')
                  ? 'fixture-publisher/gated-GGUF'
                  : 'fixture-publisher/example-GGUF',
                downloads: 1234,
                gated: query.includes('gated'),
              },
            ],
            direct: null,
            warning: null,
          };
        }
        case 'hf_repository':
          request('repository');
          current = repository(String(args.repository));
          return current;
        case 'hf_download_start': {
          request('download');
          if (!current) throw new Error('Refresh the repository first.');
          if (
            current.gated &&
            (!token || !localStorage.getItem('straggler-fixture-hf-license-accepted'))
          )
            throw new Error(
              'Download access is restricted. Accept the repository license and add an authorized read token, then resume.',
            );
          if (jobs.some((job) => ['downloading', 'verifying'].includes(job.phase)))
            throw new Error('Pause the current download before starting another.');
          const selected = args.files as string[];
          const selectedFiles = files.filter(
            (file) =>
              selected.includes(file.path) ||
              (selected.includes(files[1].path) && file.path === files[2].path),
          );
          const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
          const job: HubDownload = {
            id: crypto.randomUUID(),
            plan: { repository: current.id, revision: current.revision, files: selectedFiles },
            root: configuration().modelsDir,
            phase: 'downloading',
            downloaded: 0,
            total,
            error: null,
          };
          jobs.push(job);
          return job.id;
        }
        case 'hf_downloads':
          for (const job of jobs) {
            if (job.phase !== 'downloading') continue;
            job.downloaded = Math.min(job.total, job.downloaded + 2 * 1024 ** 2);
            if (localStorage.getItem('straggler-fixture-hf-interrupted')) {
              job.phase = 'error';
              job.error = 'The download was interrupted. Resume to try again.';
            } else if (job.downloaded === job.total) {
              if (localStorage.getItem('straggler-fixture-hf-checksum-error')) {
                job.phase = 'error';
                job.error = 'SHA-256 verification failed.';
              } else {
                job.phase = 'completed';
                addModel({
                  path: `${job.root}/${job.plan.repository}/${job.plan.files[0].path}`,
                  label: `${job.plan.repository}/${job.plan.files[0].path}`,
                });
              }
            }
          }
          return structuredClone(jobs);
        case 'hf_download_control': {
          const job = jobs.find((job) => job.id === args.id);
          if (!job) throw new Error('This download is unavailable.');
          if (args.action === 'resume') request('resume');
          job.phase =
            args.action === 'pause'
              ? 'paused'
              : args.action === 'cancel'
                ? 'cancelled'
                : 'downloading';
          job.error = null;
          return;
        }
        case 'hf_pause_all':
          jobs
            .filter((job) => ['downloading', 'verifying'].includes(job.phase))
            .forEach((job) => {
              job.phase = 'paused';
            });
          return;
        default:
          throw new Error(`Unexpected Hub fixture command: ${command}`);
      }
    },
  };
}
