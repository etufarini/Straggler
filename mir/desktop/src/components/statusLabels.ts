import type { MessageStatus } from '../domain/types';
export const statusLabel = {
  stopped: 'Stopped',
  loading: 'Loading',
  ready: 'Ready',
  stopping: 'Stopping',
  error: 'Error',
};
export const messageStatusLabel: Record<MessageStatus, string> = {
  complete: '',
  streaming: '',
  stopped: 'Response stopped',
  interrupted: 'Response interrupted',
  error: 'Response failed · partial text kept',
  length: 'Output limit reached',
};
