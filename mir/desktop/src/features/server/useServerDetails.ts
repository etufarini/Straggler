import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { ServerDetails, ServerStatus } from '../../domain/types';

const unknownContextRetryMs = 1000;

export function useServerDetails(server: ServerStatus) {
  const [details, setDetails] = useState<ServerDetails | null>(null);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isTauri() && server.phase === 'ready' && server.runId) {
      async function readDetails() {
        let retry = true;
        try {
          const value = await invoke<ServerDetails>('server_details');
          if (!disposed) setDetails(value);
          retry = value.contextSize === null || !!value.error;
        } catch (error) {
          if (!disposed)
            setDetails({
              runId: server.runId!,
              contextSize: null,
              reasoningSupported: null,
              effortLevels: [],
              systemRoleSupported: null,
              error: errorDetail(error).message,
            });
        }
        if (!disposed && retry) timer = setTimeout(() => void readDetails(), unknownContextRetryMs);
      }
      void readDetails();
    }
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [server.phase, server.runId]);
  return server.phase === 'ready' && details?.runId === server.runId ? details : null;
}
