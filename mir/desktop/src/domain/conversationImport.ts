import { newConversation } from './types';
import { inheritedChatOptions } from './chat';
import type { Conversation } from './types';

// This is the validated native result, never unchecked file JSON.
export interface ImportedConversation {
  title: string | null;
  createdAt: string | null;
  model: string | null;
  systemPrompt: string | null;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    reasoning: string;
    model: string | null;
  }[];
}

export function materializeImport(imported: ImportedConversation, updatedAt: number): Conversation {
  const createdAt = imported.createdAt ? Date.parse(imported.createdAt) : NaN;
  const firstUser = imported.messages.find((message) => message.role === 'user');
  const derivedTitle = Array.from(firstUser?.content.trim() ?? '')
    .slice(0, 80)
    .join('');
  return {
    ...newConversation(),
    title: imported.title?.trim() || derivedTitle || 'Imported conversation',
    createdAt: Number.isFinite(createdAt) && createdAt >= 0 ? createdAt : updatedAt,
    updatedAt,
    model: imported.model,
    options: { ...inheritedChatOptions, systemPrompt: imported.systemPrompt ?? '' },
    messages: imported.messages.map((message) => ({
      id: crypto.randomUUID(),
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      status: 'complete',
      ...(message.model ? { model: message.model } : {}),
    })),
  };
}
