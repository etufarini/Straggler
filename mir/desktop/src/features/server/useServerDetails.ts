import { useEffect, useState } from 'react';
import { invoke, isTauri } from '../../services/desktop';
import { errorDetail } from '../../domain/errors';
import type { ServerDetails, ServerStatus } from '../../domain/types';

export function useServerDetails(server: ServerStatus) {
  const [details, setDetails] = useState<ServerDetails | null>(null);
  useEffect(() => {
    let disposed = false;
    if (isTauri() && server.phase === 'ready' && server.runId) {
      void invoke<ServerDetails>('server_details')
        .then((value) => {
          if (!disposed) setDetails(value);
        })
        .catch((error) => {
          if (!disposed)
            setDetails({
              runId: server.runId!,
              contextSize: null,
              reasoningSupported: null,
              effortLevels: [],
              systemRoleSupported: null,
              error: errorDetail(error).message,
            });
        });
    }
    return () => {
      disposed = true;
    };
  }, [server.phase, server.runId]);
  return server.phase === 'ready' && details?.runId === server.runId ? details : null;
}
