import type { ActiveCloud } from '../../domain/cloudModels';
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
  searchProjectFiles = false,
  searchAttachments = false,
  cloud: ActiveCloud | null = null,
  includeReasoning = false,
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
        searchProjectFiles || searchAttachments ? [] : undefined,
        searchAttachments ? [] : undefined,
        includeReasoning,
        details?.systemRoleSupported,
      );
  const key = JSON.stringify(messages);
  const [measured, setMeasured] = useState<{
    key: string;
    run?: string;
    estimate: TokenEstimate;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    if (cloud || server.phase !== 'ready' || unavailable) return;
    const timer = setTimeout(() => {
      void estimatePromptTokens(JSON.parse(key)).then((estimate) => {
        if (!disposed) setMeasured({ key, run: server.runId, estimate });
      });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, server.phase, server.runId, unavailable, cloud]);
  const estimate =
    !cloud && measured?.key === key && measured.run === server.runId && server.phase === 'ready'
      ? measured.estimate
      : {
          tokens: approximatePromptTokens(messages),
          source: 'approximate' as const,
        };
  const images =
    details?.visionSupported === true
      ? (chat.attachments ?? []).filter((attachment) => attachment.image)
      : [];
  const includesImages = images.length > 0;
  // A coarse patch estimate is descriptive only; native usage replaces it after generation.
  const imageTokens = images.reduce(
    (total, attachment) =>
      total +
      (attachment.image
        ? Math.ceil(attachment.image.width / 32) * Math.ceil(attachment.image.height / 32)
        : 0),
    0,
  );
  const capacity = cloud
    ? cloud.model.details.contextSize
    : details?.runId === server.runId
      ? details?.contextSize
      : null;
  return {
    ...estimate,
    tokens: estimate.tokens + imageTokens,
    source: includesImages ? ('approximate' as const) : estimate.source,
    includesImages,
    capacity,
    overflow: !!capacity && estimate.tokens > capacity,
    unavailable,
  };
}
