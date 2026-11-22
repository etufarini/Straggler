import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectMutation } from '../../domain/projects';
import type { ServerDetails, ServerStatus, Settings } from '../../domain/types';
import { errorDetail } from '../../domain/errors';
import { flushStorage, serializeStorage, trackStorageWork } from '../../domain/storageQueue';
import type { StorageQueue } from '../../domain/storageQueue';
import {
  estimateProjectTokens,
  projectContextState,
  projectSystemPrefix,
  projectInstructions,
} from '../../domain/projectContext';
import {
  chooseAttachmentFiles,
  estimateTextTokens,
  isTauri,
  projectService,
} from '../../services/desktop';
import type { TokenEstimate } from '../../services/desktop';
import { pendingAttachmentRow, approximateTokens } from '../../domain/attachments';
import type { AttachmentRow } from '../../domain/attachments';

export function useProjects(
  queue: StorageQueue,
  server: ServerStatus,
  settings: Settings | undefined,
  details: ServerDetails | null,
  cloud = false,
) {
  const [projects, setProjects] = useState<Project[]>([]);
  const current = useRef(projects);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<Record<string, AttachmentRow[]>>({});
  const [notice, setNotice] = useState<{ message: string; undoToken?: string } | null>(null);
  const [measured, setMeasured] = useState<{
    key: string;
    values: Record<string, TokenEstimate>;
  } | null>(null);
  const mounted = useRef(true);
  const pendingWork = useRef(new Set<Promise<unknown>>());

  function accept(project: Project) {
    current.current = [...current.current.filter((value) => value.id !== project.id), project];
    setProjects(current.current);
  }
  const load = useCallback(async () => {
    try {
      await flushStorage(queue, pendingWork.current).catch(() => {});
      const values = await serializeStorage(queue, () => projectService.list());
      if (!mounted.current) return;
      current.current = values;
      setProjects(values);
      setReady(true);
      setError('');
    } catch (failure) {
      if (mounted.current) setError(errorDetail(failure).message);
    }
  }, [queue]);
  useEffect(() => {
    mounted.current = true;
    if (isTauri()) void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    setBusy((count) => count + 1);
    try {
      const result = await serializeStorage(queue, operation);
      setError(
        result &&
          typeof result === 'object' &&
          'warning' in result &&
          typeof result.warning === 'string'
          ? result.warning
          : '',
      );
      return result;
    } catch (failure) {
      setError(errorDetail(failure).message);
      throw failure;
    } finally {
      setBusy((count) => count - 1);
    }
  }
  function mutation(operation: () => Promise<ProjectMutation>) {
    return run(async () => {
      const result = await operation();
      accept(result.project);
      return result;
    });
  }
  function update(
    id: string,
    patch:
      | Partial<Pick<Project, 'name' | 'description' | 'instructions' | 'starred' | 'archived'>>
      | ((project: Project) => Project),
  ) {
    return mutation(() => {
      const project = current.current.find((value) => value.id === id);
      if (!project) throw new Error('Project does not exist.');
      const value =
        typeof patch === 'function' ? patch(structuredClone(project)) : { ...project, ...patch };
      return projectService.save(value);
    });
  }
  function addFiles(id: string, paths?: string[]) {
    return trackStorageWork(pendingWork.current, () => addFileBatch(id, paths));
  }
  function updatePendingFiles(id: string, update: (rows: AttachmentRow[]) => AttachmentRow[]) {
    setPendingFiles((values) => ({ ...values, [id]: update(values[id] ?? []) }));
  }
  function removePendingFile(id: string, fileId: string) {
    updatePendingFiles(id, (rows) => rows.filter((row) => row.id !== fileId));
  }
  async function addFileBatch(id: string, paths?: string[]) {
    let selected: string[];
    try {
      selected = paths ?? (await chooseAttachmentFiles(true));
    } catch (failure) {
      setError(errorDetail(failure).message);
      return;
    }
    if (!selected.length) return;
    const rows = selected.map(pendingAttachmentRow);
    updatePendingFiles(id, (values) => [...values, ...rows]);
    await run(async () => {
      let warning: string | undefined;
      for (const [index, path] of selected.entries()) {
        const row = rows[index];
        try {
          const result = await projectService.addFile(id, path);
          accept(result.project);
          removePendingFile(id, row.id);
        } catch (failure) {
          const message = errorDetail(failure).message;
          warning = message;
          updatePendingFiles(id, (values) =>
            values.map((value) =>
              value.id === row.id ? { ...value, state: 'error', error: message } : value,
            ),
          );
        }
      }
      return { warning };
    });
  }

  const prefixes = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project) => [project.id, projectSystemPrefix(project, settings)]),
      ),
    [projects, settings],
  );
  const texts = useMemo(
    () =>
      JSON.stringify(
        projects.flatMap((project) => [
          prefixes[project.id],
          projectInstructions(project, settings),
          ...project.files.map((file) => file.text),
        ]),
      ),
    [projects, prefixes, settings],
  );
  const measurementKey = useMemo(
    () => JSON.stringify([texts, server.phase, server.runId]),
    [texts, server.phase, server.runId],
  );
  useEffect(() => {
    let disposed = false;
    const content: string[] = JSON.parse(texts);
    if (server.phase !== 'ready') return;
    const timer = setTimeout(() => {
      void Promise.all(
        [...new Set(content)].map(async (text) => [text, await estimateTextTokens(text)] as const),
      ).then((values) => {
        if (!disposed) setMeasured({ key: measurementKey, values: Object.fromEntries(values) });
      });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [texts, server.phase, measurementKey]);
  function estimate(text: string): TokenEstimate {
    const value =
      server.phase === 'ready' && measured?.key === measurementKey
        ? measured.values[text]
        : undefined;
    return !cloud && value?.source === 'server'
      ? value
      : {
          tokens: cloud ? approximateTokens(text) : estimateProjectTokens(text),
          source: 'approximate',
        };
  }
  function context(project: Project) {
    const count = estimate(prefixes[project.id] ?? projectSystemPrefix(project, settings));
    const capacity = cloud
      ? details?.contextSize
      : server.phase === 'ready' && details?.runId === server.runId
        ? details?.contextSize
        : null;
    const instructions = estimate(projectInstructions(project, settings));
    return projectContextState(
      count.tokens,
      capacity,
      count.source !== 'server',
      instructions.tokens,
    );
  }
  return {
    projects,
    current,
    ready,
    error,
    setError,
    busy: busy > 0,
    pendingFiles,
    removePendingFile,
    notice,
    setNotice,
    load,
    flush: () => flushStorage(queue, pendingWork.current),
    update,
    addFiles,
    replaceFile: (projectId: string, fileId: string) =>
      trackStorageWork(pendingWork.current, async () => {
        const paths = await chooseAttachmentFiles(true);
        if (!paths.length) return;
        if (paths.length !== 1) {
          setError('Choose one file to replace this project file.');
          return;
        }
        await mutation(() => projectService.addFile(projectId, paths[0], fileId));
      }),
    context,
    estimate,
    create: (project: Project) => mutation(() => projectService.save(project)),
    removeFile: (projectId: string, fileId: string) =>
      mutation(() => projectService.removeFile(projectId, fileId)),
    moveChat: (conversationId: string, projectId: string | null) =>
      run(() => projectService.moveChat(conversationId, projectId)),
    deleteProject: (projectId: string, deleteChats: boolean) =>
      run(async () => {
        const result = await projectService.delete(projectId, deleteChats);
        current.current = current.current.filter((project) => project.id !== projectId);
        setProjects(current.current);
        return result;
      }),
    undo: (token: string) =>
      run(async () => {
        const result = await projectService.undo(token);
        if (result.project) accept(result.project);
        return result;
      }),
  };
}
export type ProjectsController = ReturnType<typeof useProjects>;
