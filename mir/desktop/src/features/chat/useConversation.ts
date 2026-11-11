import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Channel,
  invoke,
  isTauri,
  saveConversationExport,
  chooseConversationImport,
  estimatePromptTokens,
} from '../../services/desktop';
import { newConversation } from '../../domain/types';
import { inheritedChatOptions, resolveChatOptions } from '../../domain/chat';
import { replaceMessage, regenerationHistory } from '../../domain/messageActions';
import { materializeImport } from '../../domain/conversationImport';
import type { ImportedConversation } from '../../domain/conversationImport';
import { fileName } from '../../domain/types';
import { composeRequest } from '../../domain/attachments';
import { exportFileName, serializeConversation } from '../../domain/conversationExport';
import { errorDetail } from '../../domain/errors';
import type {
  Conversation,
  Delta,
  Message,
  Response,
  ServerStatus,
  Settings,
  ChatOptions,
} from '../../domain/types';

export function useConversation(
  server: ServerStatus,
  settings?: Settings,
  contextSize?: number | null,
) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chat, setChat] = useState<Conversation>(newConversation);
  const [input, setInput] = useState('');
  const [contextError, setContextError] = useState('');
  const [editor, setEditor] = useState<{ messageId: string; text: string } | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const mutation = useRef(false);
  const [storageError, setStorageError] = useState('');
  const [fileError, setFileError] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<{ fileName: string; details: string } | null>(
    null,
  );
  const [fileNotice, setFileNotice] = useState('');
  useEffect(() => {
    if (!fileNotice) return;
    const timer = setTimeout(() => setFileNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [fileNotice]);
  const [historyReady, setHistoryReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<'waiting' | 'reasoning' | 'generating'>(
    'waiting',
  );
  const chatRef = useRef(chat);
  const requestRef = useRef<string | null>(null);
  const cancelledRef = useRef<string | null>(null);
  const sendPromise = useRef<Promise<void> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const messageList = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  function updateChat(value: Conversation) {
    chatRef.current = value;
    setChat(value);
  }
  const loadHistory = useCallback(async () => {
    try {
      const values = await invoke<Conversation[]>('history_list');
      if (!mounted.current) return;
      setConversations(values);
      setHistoryReady(true);
      setStorageError('');
    } catch (e) {
      if (mounted.current) setStorageError(errorDetail(e).message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (isTauri()) void loadHistory();
    return () => {
      mounted.current = false;
    };
  }, [loadHistory]);
  useLayoutEffect(() => {
    const list = messageList.current;
    if (follow.current && list)
      list.scrollTo({ top: list.scrollHeight, behavior: generating ? 'instant' : 'smooth' });
  }, [chat, generating]);
  function save(value: Conversation, create = false): Promise<void> {
    const snapshot = structuredClone(value);
    const pending = saveQueue.current
      .catch(() => {})
      .then(async () => {
        await invoke(create ? 'history_create' : 'history_save', { conversation: snapshot });
        if (mounted.current) {
          setStorageError('');
          setConversations((current) =>
            [snapshot, ...current.filter((c) => c.id !== snapshot.id)].sort(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
          );
        }
      });
    saveQueue.current = pending;
    void pending.catch((e) => {
      if (mounted.current && !create) setStorageError(errorDetail(e).message);
    });
    return pending;
  }

  async function cancel() {
    if (requestRef.current) {
      cancelledRef.current = requestRef.current;
      await invoke('cancel_generation', { requestId: requestRef.current });
    }
  }

  async function send(replacement?: Message[]) {
    const text = input.trim();
    if (
      (!replacement && (!text || editor)) ||
      requestRef.current ||
      mutation.current ||
      server.phase !== 'ready' ||
      !historyReady ||
      storageError
    )
      return;
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setGenerating(true);
    setGenerationPhase('waiting');
    follow.current = true;
    const user: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      reasoning: '',
      status: 'complete',
    };
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      serverRunId: server.runId,
      ...(server.model ? { model: server.model } : {}),
      content: '',
      reasoning: '',
      status: 'streaming',
    };
    let current: Conversation = {
      ...chatRef.current,
      updatedAt: Date.now(),
      model: server.model,
      title: chatRef.current.messages.length ? chatRef.current.title : text.slice(0, 80),
      messages: [...(replacement ?? [...chatRef.current.messages, user]), assistant],
    };
    const options = resolveChatOptions(current.options, settings);
    const messages = composeRequest(
      current.messages.slice(0, -1),
      options.systemPrompt,
      current.attachments ?? [],
    );
    const estimate = await estimatePromptTokens(messages);
    if (contextSize && estimate.tokens > contextSize) {
      setContextError(
        `The prompt and attachments exceed the ${contextSize.toLocaleString('en-US')}-token context. Remove files, shorten your message or increase the context size.`,
      );
      requestRef.current = null;
      setGenerating(false);
      return;
    }
    setContextError('');
    if (!replacement) {
      setInput('');
      updateChat(current);
    }
    const onDelta = new Channel<Delta>();
    let generationStarted = false;
    let lastSave = Date.now();
    onDelta.onmessage = (delta) => {
      if (requestRef.current !== requestId) return;
      assistant.content += delta.content;
      assistant.reasoning += delta.reasoning;
      if (delta.metrics)
        assistant.metrics = { ...assistant.metrics, ...delta.metrics, runId: server.runId };
      if (delta.content) setGenerationPhase('generating');
      else if (delta.reasoning) setGenerationPhase('reasoning');
      current = {
        ...current,
        messages: [...current.messages.slice(0, -1), { ...assistant }],
        updatedAt: Date.now(),
      };
      updateChat(current);
      if (Date.now() - lastSave > 2000) {
        lastSave = Date.now();
        void save(current).catch(() => {});
      }
    };
    try {
      // Persist the user's message before asking the server to generate.
      await save(current);
      updateChat(current);
      setEditor(null);
      generationStarted = true;
      const response: Response =
        cancelledRef.current === requestId
          ? { status: 'stopped', content: '', reasoning: '', error: null }
          : await invoke<Response>('generate', {
              request: {
                requestId,
                messages,
                options: { reasoning: options.reasoning, effort: options.effort },
              },
              onDelta,
            });
      assistant.status = response.status;
      assistant.content = response.content;
      assistant.reasoning = response.reasoning;
      if (response.metrics)
        assistant.metrics = { ...assistant.metrics, ...response.metrics, runId: server.runId };
      if (response.error) assistant.error = response.error;
    } catch (e) {
      assistant.status = 'error';
      if (generationStarted) assistant.error = errorDetail(e).message;
    } finally {
      // Ignore any queued IPC deltas once the final snapshot has arrived.
      requestRef.current = null;
      current = {
        ...current,
        updatedAt: Date.now(),
        messages: [...current.messages.slice(0, -1), { ...assistant }],
      };
      if (!replacement || generationStarted) {
        updateChat(current);
        await save(current).catch(() => {});
      }
      setGenerating(false);
      textarea.current?.focus();
    }
  }

  function acceptStoredConversation(value: Conversation) {
    updateChat(value);
    setConversations((values) =>
      [value, ...values.filter((item) => item.id !== value.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
  }

  async function runConversationMutation(operation: () => Promise<void>) {
    if (requestRef.current || mutation.current)
      throw new Error('Wait for the current conversation operation to finish.');
    mutation.current = true;
    setEditingBusy(true);
    try {
      await saveQueue.current;
      await save(chatRef.current);
      const pending = operation();
      saveQueue.current = pending;
      await pending;
    } finally {
      mutation.current = false;
      setEditingBusy(false);
    }
  }

  async function importChat() {
    if (mutation.current || importBusy) return;
    let path: string | null = null;
    mutation.current = true;
    setImportBusy(true);
    try {
      path = await chooseConversationImport();
      if (!path) return;
      setImportError(null);
      const imported = await invoke<ImportedConversation>('read_conversation_import', { path });
      // Validate before disturbing an active response or writing any conversation.
      await cancel();
      await sendPromise.current;
      await saveQueue.current;
      mutation.current = true;
      const value = materializeImport(
        imported,
        Math.max(Date.now(), ...conversations.map((item) => item.updatedAt + 1)),
      );
      await save(value, true);
      setEditor(null);
      updateChat(value);
      setInput('');
      follow.current = true;
    } catch (error) {
      setImportError({
        fileName: path ? fileName(path) : 'File selection',
        details: errorDetail(error).message,
      });
    } finally {
      mutation.current = false;
      setImportBusy(false);
    }
  }

  async function exportChat(value: Conversation, includesReasoning: boolean) {
    setFileError('');
    try {
      const snapshot = value.id === chatRef.current.id ? chatRef.current : value;
      const contents = serializeConversation(
        snapshot,
        includesReasoning,
        new Date().toISOString(),
        settings,
      );
      if (await saveConversationExport(exportFileName(snapshot.title), contents))
        setFileNotice('Conversation exported.');
    } catch (error) {
      setFileError(errorDetail(error).message);
    }
  }

  function beginEdit(message: Message) {
    if (requestRef.current || mutation.current) return;
    setEditor({ messageId: message.id, text: message.content });
  }

  async function regenerate(messageId: string, text?: string) {
    const original = chatRef.current;
    const value =
      text === undefined ? original : replaceMessage(original, messageId, text, Date.now());
    const pending = send(regenerationHistory(value, messageId));
    sendPromise.current = pending;
    await pending;
  }

  async function saveEdit() {
    if (!editor || mutation.current || requestRef.current) return;
    const original = chatRef.current;
    const message = original.messages.find((value) => value.id === editor.messageId);
    if (!message) return;
    if (message.role === 'user') {
      await regenerate(message.id, editor.text);
      return;
    }
    mutation.current = true;
    setEditingBusy(true);
    try {
      const value = replaceMessage(original, message.id, editor.text, Date.now());
      await save(value);
      updateChat(value);
      setEditor(null);
    } finally {
      mutation.current = false;
      setEditingBusy(false);
    }
  }

  function setChatOptions(patch: Partial<ChatOptions>) {
    if (requestRef.current || mutation.current) return;
    const value = {
      ...chatRef.current,
      options: { ...inheritedChatOptions, ...chatRef.current.options, ...patch },
      updatedAt: Date.now(),
    };
    updateChat(value);
    if (value.messages.length) void save(value).catch(() => {});
  }

  function openConversation(value: Conversation) {
    if (requestRef.current || mutation.current) return;
    setEditor(null);
    updateChat(structuredClone(value));
    setInput('');
    follow.current = true;
  }

  return {
    runConversationMutation,
    acceptStoredConversation,
    contextError,
    importChat,
    importBusy,
    importError,
    setImportError,
    exportChat,
    fileError,
    setFileError,
    fileNotice,
    editor,
    setEditor,
    editingBusy,
    beginEdit,
    saveEdit,
    regenerate,
    generationPhase,
    setChatOptions,
    conversations,
    setConversations,
    chat,
    input,
    setInput,
    storageError,
    historyReady,
    generating,
    chatRef,
    sendPromise,
    saveQueue,
    messageList,
    follow,
    textarea,
    updateChat,
    loadHistory,
    save,
    cancel,
    send,
    openConversation,
  };
}

export type ConversationController = ReturnType<typeof useConversation>;
