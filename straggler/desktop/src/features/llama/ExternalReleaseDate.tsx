import { useEffect, useState } from 'react';
import type { BackendRelease } from '../../domain/backendRelease';
import { errorDetail } from '../../domain/errors';
import { getBackendRelease } from '../../services/desktop';

type Lookup = BackendRelease | { status: 'loading' } | { status: 'error'; message: string };

export default function ExternalReleaseDate({ native }: { native: boolean }) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    setLookup({ status: 'loading' });
    async function readRelease() {
      try {
        const result = await getBackendRelease();
        if (!disposed) setLookup(result);
      } catch (error) {
        if (!disposed) setLookup({ status: 'error', message: errorDetail(error).message });
      }
    }
    void readRelease();
    return () => {
      disposed = true;
    };
  }, [native, attempt]);

  if (!native) return <>Native services unavailable</>;
  switch (lookup.status) {
    case 'loading':
      return <span role="status">Checking GitHub…</span>;
    case 'verified':
      return (
        <div className="release-date-result">
          <time dateTime={lookup.date}>{lookup.date}</time>
          <small>Published on GitHub · {lookup.tag}</small>
        </div>
      );
    case 'notFound':
      return <>No published release found</>;
    case 'commitMismatch':
      return <>No release matches this build’s commit</>;
    case 'unidentified':
      return <>Can’t verify the release date: build identity unavailable</>;
    case 'error':
      return (
        <div className="release-date-result">
          <span role="status">Release date unavailable</span>
          <small>{lookup.message}</small>
          <button className="text-button" type="button" onClick={() => setAttempt(attempt + 1)}>
            Retry lookup
          </button>
        </div>
      );
  }
}
