import type { MessageStatus, ServerStatus } from './types';

export type PresenceState =
  'offline' | 'loading' | 'ready' | 'reasoning' | 'generating' | 'stopped' | 'error';

export function assistantState(input: {
  serverPhase: ServerStatus['phase'];
  generating: boolean;
  generationPhase: 'waiting' | 'reasoning' | 'generating';
  serverRunId?: string;
  responseRunId?: string;
  responseStatus?: MessageStatus;
}): PresenceState {
  if (input.serverPhase === 'error' || input.serverPhase === 'needs-restart') return 'error';
  if (input.serverPhase === 'stopped' || input.serverPhase === 'stopping') return 'offline';
  if (input.serverPhase === 'loading') return 'loading';
  if (input.generating)
    return input.generationPhase === 'waiting' ? 'loading' : input.generationPhase;
  if (input.responseRunId && input.responseRunId === input.serverRunId) {
    if (input.responseStatus === 'stopped') return 'stopped';
    if (input.responseStatus === 'error' || input.responseStatus === 'interrupted') return 'error';
  }
  return 'ready';
}

export const presenceLabels: Record<PresenceState, { label: string; short: string }> = {
  offline: { label: 'Waiting for a model', short: 'Offline' },
  loading: { label: 'Getting ready…', short: 'Loading' },
  ready: { label: 'Waiting for your message', short: 'Ready' },
  reasoning: { label: 'Thinking…', short: 'Thinking' },
  generating: { label: 'Writing the answer…', short: 'Writing' },
  stopped: { label: 'Stopped by you', short: 'Stopped' },
  error: { label: 'Needs attention', short: 'Error' },
};
