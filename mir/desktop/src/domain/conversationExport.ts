import { resolveChatOptions } from './chat';
import type { Conversation, Settings } from './types';

export function exportFileName(title: string): string {
  const safe = title
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '');
  const stem = Array.from(safe.replace(/\.json$/i, ''))
    .slice(0, 120)
    .join('')
    .trim();
  return `${stem || 'conversation'}.json`;
}

export function serializeConversation(
  conversation: Conversation,
  includesReasoning: boolean,
  exportedAt: string,
  settings?: Settings,
): string {
  const systemPrompt = resolveChatOptions(conversation.options, settings).systemPrompt;
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
