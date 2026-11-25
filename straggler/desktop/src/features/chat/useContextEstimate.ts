import type { ActiveCloud } from '../../domain/cloudModels';
import { useEffect, useState } from 'react';
import { approximatePromptTokens, estimateImageTokens } from '../../domain/attachments';
import { contextWindowUsage, replyTargetTokens } from '../../domain/chat';
import { compactionBudget, draftCompactionCandidate } from '../../domain/compaction';
import type { CompactionReport, CompactionResult } from '../../domain/compaction';
import { assembleProjectRequest } from '../../domain/projectContext';
import type { Project } from '../../domain/projects';
import { estimatePromptTokens } from '../../services/desktop';
import type { TokenEstimate } from '../../services/desktop';
import type { Conversation, ServerDetails, ServerStatus, Settings } from '../../domain/types';

interface ContextCompaction {
  chatId: string;
  summary: NonNullable<Conversation['summary']>;
  backend: string | undefined;
  capacity: number | null;
  applied: boolean;
  result: CompactionResult | null;
}

function useLocalPromptCount(key: string | null, run: string | undefined, enabled: boolean) {
  const [measured, setMeasured] = useState<{
    key: string;
    run?: string;
    estimate: TokenEstimate;
  } | null>(null);
  useEffect(() => {
    if (!enabled || key === null) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void estimatePromptTokens(JSON.parse(key)).then((estimate) => {
        if (!disposed) setMeasured({ key, run, estimate });
      });
    }, 250);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, run, enabled]);
  return enabled && measured?.key === key && measured.run === run ? measured.estimate : undefined;
}

export function useContextEstimate(
  chat: Conversation,
  input: string,
  settings: Settings | undefined,
  server: ServerStatus,
  details: ServerDetails | null,
  project?: Project,
  searchFiles = false,
  cloud: ActiveCloud | null = null,
  searchWeb = false,
) {
  const unavailable = !!chat.projectId && project?.id !== chat.projectId;
  const available = !unavailable && (!!cloud || server.phase === 'ready');
  const backend = cloud
    ? JSON.stringify([cloud.selection.providerId, cloud.selection.modelId])
    : server.runId;
  const capacity =
    (cloud
      ? cloud.model.details.contextSize
      : details?.runId === server.runId && details?.contextSize) || null;
  const draft = input.trim();
  function promptFor(conversation: Conversation) {
    return assembleProjectRequest(
      conversation,
      draft
        ? [
            ...conversation.messages,
            { id: 'draft', role: 'user', content: draft, reasoning: '', status: 'complete' },
          ]
        : conversation.messages,
      settings,
      project,
      searchFiles ? [] : undefined,
      searchFiles ? [] : undefined,
      searchWeb && cloud?.kind === 'deepseek' && details?.toolsSupported === true,
      details?.systemRoleSupported,
    );
  }
  const messages = unavailable ? [] : promptFor(chat);
  const key = JSON.stringify(messages);
  const canMeasureLocally = available && !cloud;
  const localCount = useLocalPromptCount(key, server.runId, canMeasureLocally);
  const estimate: TokenEstimate = localCount ?? {
    tokens: approximatePromptTokens(messages),
    source: 'approximate',
  };
  const imageTokens = details?.visionSupported === true ? estimateImageTokens(chat.attachments) : 0;
  const includesImages = imageTokens > 0;
  const tokens = estimate.tokens + imageTokens;
  const usage = available ? contextWindowUsage(tokens, capacity) : null;
  const replyTarget = usage ? replyTargetTokens(usage.capacity, settings?.max_tokens, !!cloud) : 0;
  const replyShortfall = usage ? Math.max(0, replyTarget - usage.remaining) : 0;
  const overflow = available && !!capacity && estimate.tokens + Math.min(1, replyTarget) > capacity;
  const atCompactionThreshold = !!usage && usage.level !== 'normal';
  const candidate =
    capacity &&
    usage &&
    draft &&
    (replyShortfall > 0 ||
      atCompactionThreshold ||
      (settings?.chat_auto_compact === 'on' && canMeasureLocally && !localCount))
      ? draftCompactionCandidate(chat, capacity)
      : null;
  const retainedPrompt = candidate ? promptFor(candidate) : null;
  const retainedKey = retainedPrompt ? JSON.stringify(retainedPrompt) : null;
  const retainedCount = useLocalPromptCount(retainedKey, server.runId, canMeasureLocally);
  function budgetFor(originalTokens: number, retainedTokens: number) {
    return capacity
      ? compactionBudget(
          capacity,
          originalTokens + imageTokens,
          retainedTokens + imageTokens,
          replyTarget,
        )
      : null;
  }
  const canMakeRoomByCompacting =
    !!retainedPrompt &&
    (!canMeasureLocally || (!!localCount && !!retainedCount)) &&
    !!budgetFor(estimate.tokens, retainedCount?.tokens ?? approximatePromptTokens(retainedPrompt));
  const shouldMeasureAutoCompaction =
    !!retainedPrompt &&
    ((atCompactionThreshold && canMakeRoomByCompacting) ||
      (canMeasureLocally && (!localCount || (atCompactionThreshold && !retainedCount))));

  async function measureCompactionBudget(automatic: boolean) {
    if (!retainedPrompt) return null;
    const original = canMeasureLocally
      ? (localCount ?? (await estimatePromptTokens(messages)))
      : estimate;
    if (
      automatic &&
      contextWindowUsage(original.tokens + imageTokens, capacity)?.level === 'normal'
    )
      return null;
    const retainedTokens = canMeasureLocally
      ? (retainedCount ?? (await estimatePromptTokens(retainedPrompt))).tokens
      : approximatePromptTokens(retainedPrompt);
    return budgetFor(original.tokens, retainedTokens);
  }
  const [lastCompaction, setLastCompaction] = useState<ContextCompaction | null>(null);
  const summary = chat.summary;
  const compaction =
    available &&
    summary &&
    lastCompaction?.chatId === chat.id &&
    lastCompaction.backend === backend &&
    lastCompaction.summary.createdAt === summary.createdAt &&
    lastCompaction.summary.throughMessageId === summary.throughMessageId &&
    lastCompaction.summary.text === summary.text
      ? lastCompaction
      : null;

  async function compareCompaction(
    before: Conversation,
    after: Conversation,
  ): Promise<CompactionResult> {
    const previous = promptFor(before);
    const next = promptFor(after);
    const priorCount = key === JSON.stringify(previous) ? localCount : undefined;
    const [beforeCount, afterCount] = canMeasureLocally
      ? await Promise.all([
          priorCount?.source === 'server' ? priorCount : estimatePromptTokens(previous),
          estimatePromptTokens(next),
        ])
      : [];
    // If only one prompt could be templated or tokenized, compare both with the same fallback.
    const sameMethod =
      beforeCount?.source === 'server' &&
      afterCount?.source === 'server' &&
      beforeCount.templated === afterCount.templated;
    return {
      before: (sameMethod ? beforeCount.tokens : approximatePromptTokens(previous)) + imageTokens,
      after: (sameMethod ? afterCount.tokens : approximatePromptTokens(next)) + imageTokens,
      approximate:
        !sameMethod || !beforeCount.templated || includesImages || searchFiles || searchWeb,
    };
  }

  function recordCompaction(before: Conversation, after: Conversation, report?: CompactionReport) {
    if (!available || !after.summary) return;
    const comparison: ContextCompaction = {
      chatId: after.id,
      summary: after.summary,
      backend,
      capacity,
      applied: report?.applied ?? true,
      result: report?.result ?? null,
    };
    setLastCompaction(comparison);
    if (report) return;
    void compareCompaction(before, after).then((result) =>
      setLastCompaction((current) =>
        current === comparison ? { ...comparison, result } : current,
      ),
    );
  }

  return {
    available,
    tokens,
    templated: estimate.templated === true,
    approximate: !estimate.templated || includesImages || searchFiles || searchWeb,
    includesImages,
    searchFiles,
    searchWeb,
    capacity,
    usage,
    overflow,
    replyTarget,
    replyShortfall,
    canMakeRoomByCompacting,
    atCompactionThreshold,
    shouldMeasureAutoCompaction,
    measureCompactionBudget,
    compaction,
    compareCompaction,
    recordCompaction,
  };
}
