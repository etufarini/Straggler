import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { HubTokenStatus } from '../../domain/huggingFace';

export default function useHubTokenStatus() {
  const [status, setStatus] = useState<HubTokenStatus | null>(null);
  const [error, setError] = useState('');
  async function readStatus() {
    try {
      setStatus(await invoke<HubTokenStatus>('hf_token_status'));
      setError('');
    } catch (failure) {
      setError(errorDetail(failure).message);
    }
  }
  useEffect(() => {
    if (isTauri()) void readStatus();
  }, []);
  return { status, setStatus, error, readStatus };
}
