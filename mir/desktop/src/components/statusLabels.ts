import type { MessageStatus } from '../domain/types';
export const statusLabel = {
  stopped: 'Stopped',
  loading: 'Loading',
  ready: 'Ready',
  stopping: 'Stopping',
  error: 'Error',
  'needs-restart': 'Needs restart',
};
export const messageStatusLabel: Record<MessageStatus, string> = {
  complete: '',
  streaming: '',
  stopped: 'Response stopped',
  interrupted: 'Response interrupted',
  error: 'Response failed',
  length: 'Output limit reached',
};
