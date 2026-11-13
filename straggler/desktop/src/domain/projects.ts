import type { Attachment, Conversation } from './types';

export interface ProjectFile extends Attachment {
  included: boolean;
  tokens?: number;
  tokenSource?: 'server' | 'approximate';
  runId?: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  starred: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  files: ProjectFile[];
}

export interface ProjectMutation {
  project: Project;
  undoToken?: string;
}

export interface ProjectConversationMutation {
  conversation: Conversation;
  undoToken?: string;
}

export interface ProjectDeletion {
  conversations: Conversation[];
  deletedConversationIds: string[];
  warning?: string;
}

export function projectUpdatedAt(project: Project, conversations: Conversation[]): number {
  return conversations.reduce(
    (latest, chat) => (chat.projectId === project.id ? Math.max(latest, chat.updatedAt) : latest),
    project.updatedAt,
  );
}

export interface ProjectUndo {
  project?: Project;
  conversation?: Conversation;
}

export function projectNameError(
  name: string,
  projects: Project[],
  excludingId?: string,
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for the project.';
  if (Array.from(trimmed).length > 80) return 'Use at most 80 characters for the project name.';
  if (
    projects.some(
      (project) =>
        project.id !== excludingId && project.name.toLowerCase() === trimmed.toLowerCase(),
    )
  )
    return `A project named “${trimmed}” already exists. Choose another name.`;
  return undefined;
}

export function projectDescriptionError(description: string): string | undefined {
  return Array.from(description).length > 200
    ? 'Use at most 200 characters for the description.'
    : undefined;
}

export function assertProjectWritable(project: Project): void {
  if (project.archived) throw new Error('Restore this project to make changes.');
}

export function ownSystemPrompt(conversation: Conversation): string | null {
  if (conversation.ownSystemPrompt !== undefined) return conversation.ownSystemPrompt;
  return conversation.options?.systemPrompt ?? null;
}

export function moveConversationToProject(
  conversation: Conversation,
  project: Project,
  updatedAt: number,
): Conversation {
  assertProjectWritable(project);
  return {
    ...conversation,
    projectId: project.id,
    ownSystemPrompt: ownSystemPrompt(conversation),
    updatedAt,
  };
}

export function removeConversationFromProject(
  conversation: Conversation,
  updatedAt: number,
): Conversation {
  return {
    ...conversation,
    projectId: null,
    ownSystemPrompt: ownSystemPrompt(conversation),
    updatedAt,
  };
}
