import { useEffect, useRef, useState } from 'react';
import {
  addAttachment,
  chooseAttachmentFiles,
  downloadAttachment,
  estimateTextTokens,
  removeAttachment,
  watchAttachmentDrop,
  isTauri,
} from '../../services/desktop';
import type { DragDropEvent, TokenEstimate } from '../../services/desktop';
import { approximateTokens, sortAttachmentRows } from '../../domain/attachments';
import type { AttachmentRow } from '../../domain/attachments';
import { errorDetail } from '../../domain/errors';
import { fileName } from '../../domain/types';
import type { Attachment, ServerStatus } from '../../domain/types';
import type { ConversationController } from '../chat/useConversation';

export function useAttachments(conversation: ConversationController, server: ServerStatus) {
  const [pending, setPending] = useState<Record<string, AttachmentRow[]>>({});
  const [dragged, setDragged] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tokenCounts, setTokenCounts] = useState<Record<string, TokenEstimate>>({});
  const current = useRef(conversation);
  current.current = conversation;
  const onDrop = useRef<(event: DragDropEvent) => void>(() => {});
  const disabled =
    !isTauri() || conversation.generating || conversation.editingBusy || conversation.importBusy;
  const stored = conversation.chat.attachments ?? [];
  const textKey = JSON.stringify(stored.map((attachment) => [attachment.id, attachment.text]));

  useEffect(() => {
    let disposed = false;
    const attachments: [string, string][] = JSON.parse(textKey);
    void Promise.all(
      attachments.map(async ([id, text]) => [id, await estimateTextTokens(text)] as const),
    ).then((values) => {
      if (!disposed) setTokenCounts(Object.fromEntries(values));
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
    if (current.current.generating || current.current.editingBusy || current.current.importBusy) {
      setError('Attachments can be changed when the response finishes.');
      return;
    }
    const id = current.current.chatRef.current.id;
    const rows = paths.map((path): AttachmentRow => ({
      id: crypto.randomUUID(),
      name: fileName(path),
      extension: fileName(path).split('.').at(-1)?.toLowerCase() ?? '',
      size: null,
      state: 'reading',
    }));
    updatePending(id, (values) => [...values, ...rows]);
    setError('');
    try {
      await current.current.runConversationMutation(async () => {
        for (const [index, path] of paths.entries()) {
          const row = rows[index];
          try {
            const value = await addAttachment(id, path);
            current.current.acceptStoredConversation(value);
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
        const value = await removeAttachment(conversation.chat.id, row.id);
        conversation.acceptStoredConversation(value);
      });
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  async function downloadFile(attachment: Attachment) {
    try {
      setError('');
      if (await downloadAttachment(conversation.chat.id, attachment))
        setNotice('Attachment downloaded.');
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  onDrop.current = (event) => {
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
  const estimate = (attachment: Attachment): TokenEstimate =>
    tokenCounts[attachment.id] ?? {
      tokens: approximateTokens(attachment.text),
      source: 'approximate',
    };
  const tokens = stored.reduce((total, attachment) => total + estimate(attachment).tokens, 0);
  return {
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
