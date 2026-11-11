import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Channel, invoke, isTauri, saveConversationExport } from '../../services/desktop';
import { newConversation, requestMessages } from '../../domain/types';
import { inheritedChatOptions, resolveChatOptions } from '../../domain/chat';
import { replaceMessage, regenerationHistory } from '../../domain/messageActions';
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

export function useConversation(server: ServerStatus, settings?: Settings) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [chat, setChat] = useState<Conversation>(newConversation);
  const [input, setInput] = useState('');
  const [editor, setEditor] = useState<{ messageId: string; text: string } | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const mutation = useRef(false);
  const [storageError, setStorageError] = useState('');
  const [fileError, setFileError] = useState('');
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
  function save(value: Conversation): Promise<void> {
    const snapshot = structuredClone(value);
    const pending = saveQueue.current
      .catch(() => {})
      .then(async () => {
        await invoke('history_save', { conversation: snapshot });
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
      if (mounted.current) setStorageError(errorDetail(e).message);
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
    if (!replacement) setInput('');
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
    if (!replacement) updateChat(current);
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
    const options = resolveChatOptions(current.options, settings);
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
                messages: [
                  ...(options.systemPrompt
                    ? [{ role: 'system', content: options.systemPrompt }]
                    : []),
                  ...requestMessages(current.messages.slice(0, -1)),
                ],
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
