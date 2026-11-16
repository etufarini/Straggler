import { attachmentBlocks, composeRequest } from './attachments';
import { ownSystemPrompt } from './projects';
import type { Project } from './projects';
import type { Conversation, Message, Settings } from './types';

export const projectContextThresholds = { close: 0.75, over: 1 } as const;
export const projectTokenEstimateCharacters = 4;

export function projectConversationReserve(nCtx: number): number {
  return Math.ceil(nCtx * 0.25);
}

export function estimateProjectTokens(text: string): number {
  return Math.ceil(Array.from(text).length / projectTokenEstimateCharacters);
}

export interface ProjectContextState {
  used: number;
  available: number | null;
  reserve: number | null;
  capacity: number | null;
  ratio: number | null;
  level: 'unknown' | 'ok' | 'high' | 'over';
  shortfall: number;
  approximate: boolean;
}

export function projectContextState(
  used: number,
  capacity: number | null | undefined,
  approximate: boolean,
): ProjectContextState {
  if (!capacity || !Number.isFinite(capacity) || capacity < 0) {
    return {
      used,
      available: null,
      reserve: null,
      capacity: null,
      ratio: null,
      level: 'unknown',
      shortfall: 0,
      approximate,
    };
  }
  const reserve = projectConversationReserve(capacity);
  const available = Math.max(0, capacity - reserve);
  const ratio = available ? used / available : used > 0 ? Infinity : 0;
  return {
    used,
    available,
    reserve,
    capacity,
    ratio,
    level:
      ratio > projectContextThresholds.over
        ? 'over'
        : ratio >= projectContextThresholds.close
          ? 'high'
          : 'ok',
    shortfall: Math.max(0, used - available),
    approximate,
  };
}

export function resolveProjectSystemPrompt(
  conversation: Conversation,
  settings?: Settings,
  project?: Project,
): string {
  if (conversation.projectId) {
    if (project?.id !== conversation.projectId)
      throw new Error('This chat’s project is unavailable. Reload projects to continue.');
    return projectInstructions(project, settings);
  }
  return ownSystemPrompt(conversation) ?? settings?.chat_system_prompt ?? '';
}

export function projectSystemPrefix(project: Project, settings?: Settings): string {
  const instructions = projectInstructions(project, settings);
  const files = attachmentBlocks(project.files.filter((file) => file.included));
  return [instructions, files].filter((part) => part.length > 0).join('\n\n');
}

function projectInstructions(project: Project, settings?: Settings): string {
  return project.instructions.trim() ? project.instructions : (settings?.chat_system_prompt ?? '');
}

export function assembleProjectRequest(
  conversation: Conversation,
  messages: Message[],
  settings?: Settings,
  project?: Project,
) {
  const systemPrompt = resolveProjectSystemPrompt(conversation, settings, project);
  const prefix =
    conversation.projectId && project ? projectSystemPrefix(project, settings) : systemPrompt;
  return composeRequest(messages, prefix, conversation.attachments ?? []);
}
