import { useEffect, useState } from 'react';
import { approximatePromptTokens } from '../../domain/attachments';
import { assembleProjectRequest } from '../../domain/projectContext';
import type { Project } from '../../domain/projects';
import { estimatePromptTokens } from '../../services/desktop';
import type { TokenEstimate } from '../../services/desktop';
import type { Conversation, ServerDetails, ServerStatus, Settings } from '../../domain/types';

export function useContextEstimate(
  chat: Conversation,
  input: string,
  settings: Settings | undefined,
  server: ServerStatus,
  details: ServerDetails | null,
  project?: Project,
) {
  const unavailable = !!chat.projectId && project?.id !== chat.projectId;
  const messages = unavailable
    ? []
    : assembleProjectRequest(
        chat,
        [
          ...chat.messages,
          ...(input.trim()
            ? [
                {
                  id: 'draft',
                  role: 'user' as const,
                  content: input.trim(),
                  reasoning: '',
                  status: 'complete' as const,
                },
              ]
            : []),
        ],
        settings,
        project,
      );
  const key = JSON.stringify(messages);
  const [measured, setMeasured] = useState<{
    key: string;
    run?: string;
    estimate: TokenEstimate;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    if (server.phase !== 'ready' || unavailable) return;
    const timer = setTimeout(() => {
      void estimatePromptTokens(JSON.parse(key)).then((estimate) => {
        if (!disposed) setMeasured({ key, run: server.runId, estimate });
      });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, server.phase, server.runId, unavailable]);
  const estimate =
    measured?.key === key && measured.run === server.runId && server.phase === 'ready'
      ? measured.estimate
      : {
          tokens: approximatePromptTokens(messages),
          source: 'approximate' as const,
        };
  const capacity = details?.runId === server.runId ? details?.contextSize : null;
  return { ...estimate, capacity, overflow: !!capacity && estimate.tokens > capacity, unavailable };
}
