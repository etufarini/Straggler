import { resolveProjectSystemPrompt } from './projectContext';
import type { Project } from './projects';
import type { Conversation, Settings } from './types';

export function exportFileName(title: string): string {
  const safe = title
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '');
  const encoder = new TextEncoder();
  let stem = '';
  let bytes = 0;
  for (const character of safe.replace(/\.json$/i, '')) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > 200) break;
    stem += character;
    bytes += characterBytes;
  }
  stem = stem.trim();
  return `${stem || 'conversation'}.json`;
}

export function serializeConversation(
  conversation: Conversation,
  includesReasoning: boolean,
  exportedAt: string,
  settings?: Settings,
  project?: Project,
): string {
  const systemPrompt = resolveProjectSystemPrompt(conversation, settings, project);
  const messages: { role: string; content: string; model?: string; reasoning_content?: string }[] =
    [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  for (const message of conversation.messages) {
    messages.push({
      role: message.role,
      content: message.content,
      ...(message.role === 'assistant' && (message.model || conversation.model)
        ? { model: message.model || conversation.model! }
        : {}),
      ...(includesReasoning && message.role === 'assistant' && message.reasoning
        ? { reasoning_content: message.reasoning }
        : {}),
    });
  }
  return (
    JSON.stringify(
      {
        format: 'mir.cpp/conversation',
        version: 1,
        exportedAt,
        includesReasoning,
        conversation: {
          title: conversation.title,
          createdAt: new Date(conversation.createdAt).toISOString(),
          model: conversation.model,
          messages,
        },
      },
      null,
      2,
    ) + '\n'
  );
}
