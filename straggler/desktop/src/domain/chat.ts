import type { ActiveCloud } from './cloudModels';
import type {
  ChatOptions,
  GenerationMetrics,
  Message,
  ServerDetails,
  ServerStatus,
  Settings,
} from './types';

export function resolveChatOptions(
  options: ChatOptions | undefined,
  settings: Settings | undefined,
) {
  return {
    systemPrompt: options?.systemPrompt ?? settings?.chat_system_prompt ?? '',
    reasoning: options?.reasoning ?? settings?.chat_reasoning ?? 'auto',
    effort: options?.effort ?? settings?.chat_reasoning_effort ?? 'auto',
  };
}

export const inheritedChatOptions: ChatOptions = {
  systemPrompt: null,
  reasoning: null,
  effort: null,
};

export function currentContext(
  messages: Message[],
  details: ServerDetails | null,
  server: ServerStatus,
  cloud: ActiveCloud | null = null,
) {
  const last = messages.filter((message) => message.role === 'assistant').at(-1);
  const metrics: GenerationMetrics | undefined = last?.metrics;
  if (!details?.contextSize || metrics?.contextTokens === undefined) return null;
  if (cloud) {
    if (
      last?.cloud?.providerId !== cloud.selection.providerId ||
      last.model !== cloud.selection.modelId
    )
      return null;
  } else if (
    server.phase !== 'ready' ||
    details.runId !== server.runId ||
    metrics.runId !== server.runId
  )
    return null;
  const usagePercent = (metrics.contextTokens / details.contextSize) * 100;
  const percent = Math.round(usagePercent);
  return {
    tokens: metrics.contextTokens,
    capacity: details.contextSize,
    percent,
    source: metrics.contextSource,
    level: usagePercent >= 90 ? 'full' : usagePercent >= 75 ? 'high' : 'normal',
  } as const;
}
