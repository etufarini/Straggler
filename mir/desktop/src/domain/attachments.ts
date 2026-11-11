import { requestMessages } from './types';
import type { Attachment, Message } from './types';

export const attachmentTypes = ['txt', 'md', 'docx', 'xlsx', 'pptx'] as const;
export type AttachmentRow = {
  id: string;
  name: string;
  extension: string;
  size: number | null;
  state: 'ready' | 'reading' | 'error';
  error?: string;
  attachment?: Attachment;
};

export function sortAttachmentRows(rows: AttachmentRow[]): AttachmentRow[] {
  return [...rows].sort((a, b) => {
    if (a.state === 'error' && b.state !== 'error') return 1;
    if (b.state === 'error' && a.state !== 'error') return -1;
    const typeOrder = (extension: string) => {
      const index = (attachmentTypes as readonly string[]).indexOf(extension);
      return index < 0 ? attachmentTypes.length : index;
    };
    return typeOrder(a.extension) - typeOrder(b.extension) || a.name.localeCompare(b.name);
  });
}

export function attachmentBlocks(attachments: Attachment[]): string {
  return attachments
    .map(
      (attachment) =>
        `--- BEGIN ATTACHMENT ${JSON.stringify(attachment.name)} ---\n${attachment.text}\n--- END ATTACHMENT ${JSON.stringify(attachment.name)} ---`,
    )
    .join('\n\n');
}

export function composeRequest(
  messages: Message[],
  systemPrompt: string,
  attachments: Attachment[],
) {
  const turns: { role: 'system' | 'user' | 'assistant'; content: string }[] =
    requestMessages(messages);
  if (attachments.length) {
    const blocks = attachmentBlocks(attachments);
    const firstUser = turns.find((message) => message.role === 'user');
    if (firstUser) firstUser.content = `${blocks}\n\n${firstUser.content}`;
    else turns.unshift({ role: 'user', content: blocks });
  }
  if (systemPrompt) turns.unshift({ role: 'system', content: systemPrompt });
  return turns;
}

export function approximateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}
