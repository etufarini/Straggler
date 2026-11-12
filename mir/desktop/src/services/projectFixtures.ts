import {
  assertProjectWritable,
  moveConversationToProject,
  projectDescriptionError,
  projectNameError,
  removeConversationFromProject,
} from '../domain/projects';
import type { Project, ProjectUndo } from '../domain/projects';
import type { Conversation } from '../domain/types';
import { attachmentTypes } from '../domain/attachments';

// Development transport only. Native storage/rollback is verified independently.
export function createProjectFixture(
  key: string,
  history: Conversation[],
  persistHistory: () => void,
  generating: () => string | null,
) {
  let projects: Project[] = JSON.parse(localStorage.getItem(key) || '[]');
  const inverses = new Map<string, { expires: number; reverse: () => ProjectUndo }>();
  function find(id: unknown) {
    const project = projects.find((value) => value.id === id);
    if (!project) throw new Error('Project does not exist.');
    return project;
  }
  function persist() {
    localStorage.setItem(key, JSON.stringify(projects));
  }
  function undo(reverse: () => ProjectUndo) {
    const token = crypto.randomUUID();
    inverses.set(token, { expires: Date.now() + 8000, reverse });
    return token;
  }
  function timestamp(project: Project) {
    project.updatedAt = Math.max(Date.now(), project.updatedAt + 1);
  }
  function projectBusy(id: string) {
    return history.some((chat) => chat.id === generating() && chat.projectId === id);
  }
  function assertChatWritable(chat: Conversation) {
    if (chat.id === generating())
      throw new Error('Available when the current response finishes or is stopped');
    if (chat.projectId) assertProjectWritable(find(chat.projectId));
  }
  async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
    if (command === 'projects_list') return structuredClone(projects);
    if (localStorage.getItem('mir-fixture-project-save-error'))
      throw new Error('Project storage is not writable.');
    if (command === 'project_save') {
      const next = structuredClone(args.project as Project);
      const previous = projects.find((value) => value.id === next.id);
      const error =
        projectNameError(next.name, projects, next.id) || projectDescriptionError(next.description);
      if (error) throw new Error(error);
      next.name = next.name.trim();
      next.description = next.description.trim();
      if (previous?.archived && next.archived) assertProjectWritable(previous);
      if (previous && previous.archived !== next.archived && projectBusy(previous.id))
        throw new Error('Available when the current response finishes or is stopped');
      timestamp(next);
      const undoToken =
        previous && previous.archived !== next.archived
          ? undo(() => {
              const current = find(next.id);
              if (current.archived !== next.archived || projectBusy(next.id))
                throw new Error('The project changed. This action cannot be undone.');
              current.archived = previous.archived;
              timestamp(current);
              persist();
              return { project: structuredClone(current) };
            })
          : undefined;
      projects = [...projects.filter((value) => value.id !== next.id), next];
      persist();
      return { project: structuredClone(next), undoToken };
    }
    if (command === 'project_file_add') {
      const project = find(args.projectId);
      assertProjectWritable(project);
      const name = String(args.path).split('/').at(-1)!;
      const extension = attachmentTypes.find((type) => name.toLowerCase().endsWith(`.${type}`));
      if (!extension) throw new Error('This file type is not supported.');
      while (localStorage.getItem('mir-fixture-reading-paused'))
        await new Promise((resolve) => setTimeout(resolve, 20));
      const text = `Extracted fixture text from ${name}.`;
      project.files.push({
        id: crypto.randomUUID(),
        name,
        extension,
        size: 1234,
        included: true,
        text,
      });
      timestamp(project);
      persist();
      return { project: structuredClone(project) };
    }
    if (command === 'project_file_remove') {
      const project = find(args.projectId);
      assertProjectWritable(project);
      const index = project.files.findIndex((file) => file.id === args.fileId);
      if (index < 0) throw new Error('Project file does not exist.');
      const [removed] = project.files.splice(index, 1);
      timestamp(project);
      persist();
      return {
        project: structuredClone(project),
        undoToken: undo(() => {
          const current = find(project.id);
          assertProjectWritable(current);
          if (current.files.some((file) => file.id === removed.id))
            throw new Error('This file has already been restored.');
          current.files.splice(index, 0, removed);
          timestamp(current);
          persist();
          return { project: structuredClone(current) };
        }),
      };
    }
    if (command === 'project_move_chat') {
      const index = history.findIndex((chat) => chat.id === args.conversationId);
      if (index < 0) throw new Error('Conversation does not exist.');
      const previous = structuredClone(history[index]);
      assertChatWritable(previous);
      const next = args.projectId
        ? moveConversationToProject(previous, find(args.projectId), Date.now())
        : removeConversationFromProject(previous, Date.now());
      history[index] = next;
      if (args.projectId) timestamp(find(args.projectId));
      persistHistory();
      persist();
      return {
        conversation: structuredClone(next),
        undoToken: undo(() => {
          const currentIndex = history.findIndex((chat) => chat.id === next.id);
          const current = history[currentIndex];
          if (!current || current.projectId !== next.projectId)
            throw new Error('The conversation moved again. This action cannot be undone.');
          assertChatWritable(current);
          const restored = previous.projectId
            ? moveConversationToProject(current, find(previous.projectId), Date.now())
            : removeConversationFromProject(current, Date.now());
          history[currentIndex] = restored;
          persistHistory();
          return { conversation: structuredClone(restored) };
        }),
      };
    }
    if (command === 'project_delete') {
      const project = find(args.projectId);
      assertProjectWritable(project);
      if (projectBusy(project.id))
        throw new Error('Available when the current response finishes or is stopped');
      const members = history.filter((chat) => chat.projectId === project.id);
      const conversations: Conversation[] = [];
      const deletedConversationIds: string[] = [];
      for (const chat of members) {
        const index = history.findIndex((value) => value.id === chat.id);
        if (args.deleteChats) {
          history.splice(index, 1);
          deletedConversationIds.push(chat.id);
        } else {
          const detached = removeConversationFromProject(chat, Date.now());
          history[index] = detached;
          conversations.push(detached);
        }
      }
      projects = projects.filter((value) => value.id !== project.id);
      persistHistory();
      persist();
      return { conversations: structuredClone(conversations), deletedConversationIds };
    }
    if (command === 'project_undo') {
      const token = String(args.token);
      const operation = inverses.get(token);
      if (!operation || operation.expires < Date.now())
        throw new Error('This action can no longer be undone.');
      const result = operation.reverse();
      inverses.delete(token);
      return result;
    }
    throw new Error(`Unexpected project fixture command: ${command}`);
  }
  return { invoke, find, assertChatWritable };
}
