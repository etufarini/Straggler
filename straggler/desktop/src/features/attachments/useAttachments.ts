import { useEffect, useRef, useState } from 'react';
import {
  addAttachment,
  chooseAttachmentFiles,
  downloadAttachment,
  estimateTextTokens,
  removeAttachment,
  watchAttachmentDrop,
  isTauri,
  invoke,
} from '../../services/desktop';
import type { DragDropEvent, TokenEstimate } from '../../services/desktop';
import {
  approximateTokens,
  pendingAttachmentRow,
  sortAttachmentRows,
} from '../../domain/attachments';
import type { AttachmentRow } from '../../domain/attachments';
import { errorDetail } from '../../domain/errors';
import { fileName } from '../../domain/types';
import type { Attachment, ServerStatus } from '../../domain/types';
import type { ConversationController } from '../chat/useConversation';

export function useAttachments(
  conversation: ConversationController,
  server: ServerStatus,
  visible = true,
  readOnly = false,
) {
  const [pending, setPending] = useState<Record<string, AttachmentRow[]>>({});
  const [dragged, setDragged] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [measured, setMeasured] = useState<{
    key: string;
    run?: string;
    phase: string;
    values: Record<string, TokenEstimate>;
  } | null>(null);
  const current = useRef(conversation);
  current.current = conversation;
  const onDrop = useRef<(event: DragDropEvent) => void>(() => {});
  const disabled = !isTauri() || conversation.chatOptionsDisabled || readOnly;
  const stored = conversation.chat.attachments ?? [];
  const textKey = JSON.stringify(stored.map((attachment) => [attachment.id, attachment.text]));

  useEffect(() => {
    let disposed = false;
    const attachments: [string, string][] = JSON.parse(textKey);
    void Promise.all(
      attachments.map(async ([id, text]) => [id, await estimateTextTokens(text)] as const),
    ).then((values) => {
      if (!disposed)
        setMeasured({
          key: textKey,
          run: server.runId,
          phase: server.phase,
          values: Object.fromEntries(values),
        });
    });
    return () => {
      disposed = true;
    };
  }, [textKey, server.phase, server.runId]);

  function updatePending(id: string, update: (rows: AttachmentRow[]) => AttachmentRow[]) {
    setPending((values) => ({ ...values, [id]: update(values[id] ?? []) }));
  }
  async function addFiles(paths: string[]) {
    if (!paths.length) return;
    if (current.current.chatOptionsDisabled || readOnly) {
      setError('Attachments can be changed when the response finishes.');
      return;
    }
    const id = current.current.chatRef.current.id;
    const rows = paths.map(pendingAttachmentRow);
    updatePending(id, (values) => [...values, ...rows]);
    setError('');
    try {
      await current.current.runConversationMutation(async () => {
        for (const [index, path] of paths.entries()) {
          const row = rows[index];
          try {
            if (current.current.temporaryRef.current === id) {
              const attachment = await invoke<Attachment>('temporary_attachment_add', { id, path });
              current.current.updateChat({
                ...current.current.chatRef.current,
                attachments: [...(current.current.chatRef.current.attachments ?? []), attachment],
              });
            } else {
              const value = await addAttachment(id, path);
              current.current.acceptStoredConversation(value);
            }
            updatePending(id, (values) => values.filter((item) => item.id !== row.id));
          } catch (failure) {
            updatePending(id, (values) =>
              values.map((item) =>
                item.id === row.id
                  ? { ...item, state: 'error', error: errorDetail(failure).message }
                  : item,
              ),
            );
          }
        }
      });
    } catch (failure) {
      updatePending(id, (values) =>
        values.map((item) =>
          rows.some((row) => row.id === item.id)
            ? { ...item, state: 'error', error: errorDetail(failure).message }
            : item,
        ),
      );
    }
  }

  async function chooseFiles() {
    try {
      await addFiles(await chooseAttachmentFiles());
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  async function removeFile(row: AttachmentRow) {
    if (disabled) return;
    if (!row.attachment) {
      updatePending(conversation.chat.id, (values) => values.filter((item) => item.id !== row.id));
      return;
    }
    try {
      setError('');
      await conversation.runConversationMutation(async () => {
        if (conversation.temporaryRef.current === conversation.chat.id) {
          await invoke('temporary_attachment_remove', {
            id: conversation.chat.id,
            attachmentId: row.id,
          });
          conversation.updateChat({
            ...conversation.chatRef.current,
            attachments: conversation.chatRef.current.attachments?.filter(
              (attachment) => attachment.id !== row.id,
            ),
          });
        } else {
          const value = await removeAttachment(conversation.chat.id, row.id);
          conversation.acceptStoredConversation(value);
        }
      });
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  async function downloadFile(attachment: Attachment) {
    try {
      setError('');
      if (conversation.temporaryRef.current)
        throw new Error('Save this chat before downloading its attachments.');
      if (await downloadAttachment(conversation.chat.id, attachment))
        setNotice('Attachment downloaded.');
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  onDrop.current = (event) => {
    if (!visible || readOnly) return;
    if (event.type === 'leave') {
      setDragged([]);
      return;
    }
    if (event.type === 'over') return;
    if (event.type === 'enter') {
      if (!disabled) setDragged(event.paths);
      return;
    }
    setDragged([]);
    void addFiles(event.paths);
  };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void watchAttachmentDrop((event) => onDrop.current(event))
      .then((unlisten) => {
        if (disposed) unlisten();
        else unsubscribe = unlisten;
      })
      .catch((failure) => {
        if (!disposed)
          setError(`Native file drops are unavailable: ${errorDetail(failure).message}`);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const rows = sortAttachmentRows([
    ...stored.map((attachment): AttachmentRow => ({ ...attachment, state: 'ready', attachment })),
    ...(pending[conversation.chat.id] ?? []),
  ]);
  const tokenCounts =
    measured?.key === textKey && measured.run === server.runId && measured.phase === server.phase
      ? measured.values
      : {};
  const estimate = (attachment: Attachment): TokenEstimate =>
    tokenCounts[attachment.id] ?? {
      tokens: approximateTokens(attachment.text),
      source: 'approximate',
    };
  const tokens = stored.reduce((total, attachment) => total + estimate(attachment).tokens, 0);
  return {
    temporary: !!conversation.temporaryId,
    generating: conversation.generating,
    rows,
    dragged,
    disabled,
    error,
    setError,
    notice,
    chooseFiles,
    removeFile,
    downloadFile,
    estimate,
    tokens,
    approximate: stored.some((attachment) => estimate(attachment).source === 'approximate'),
    announcement: dragged.length
      ? `${dragged.length} ${dragged.length === 1 ? 'file' : 'files'} will be attached: ${dragged.map(fileName).join(', ')}`
      : '',
  };
}
export type AttachmentController = ReturnType<typeof useAttachments>;
