import type { Conversation, Message } from './types';

export function replaceMessage(
  conversation: Conversation,
  messageId: string,
  content: string,
  updatedAt: number,
): Conversation {
  const index = conversation.messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw new Error('The message is no longer in this conversation.');
  const message = conversation.messages[index];
  if (message.status === 'streaming' || message.status === 'error')
    throw new Error('This response cannot be edited.');
  if (!content.trim()) throw new Error('The message cannot be empty.');
  return {
    ...conversation,
    updatedAt,
    messages: [...conversation.messages.slice(0, index), { ...message, content }],
  };
}

export function regenerationHistory(conversation: Conversation, messageId: string): Message[] {
  const index = conversation.messages.findIndex((message) => message.id === messageId);
  if (index < 0 || conversation.messages[index].role !== 'user')
    throw new Error('Choose a user message to regenerate.');
  return conversation.messages.slice(0, index + 1);
}
