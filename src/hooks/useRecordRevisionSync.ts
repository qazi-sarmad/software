import { useCallback, useEffect, useState } from 'react';
import { nextRecordRevision, readRecordRevision, recordRevisionKey } from '../lib/liveSync';

/**
 * Same-origin record sync (SCALE-1, §17.1).
 *
 * A pop-out window shares the origin's `localStorage` with the window that opened it. When either
 * window writes a record's revision key, every OTHER window of the origin receives a `storage`
 * event and re-reads. That keeps a pop-out in sync with its parent without a server round-trip and
 * without depending on a websocket, which is the documented second half of §17.1.
 *
 * The revision is a monotonically increasing integer. The time argument is supplied by the caller
 * (Date.now() at the call site); the pure helpers in src/lib/liveSync.ts never read the clock.
 */
export interface RecordRevisionSync {
  revision: number;
  /** Publish a change: write the next revision and notify every other window. */
  bump: () => void;
}

export function useRecordRevisionSync(recordType: string, recordId: string): RecordRevisionSync {
  const enabled = Boolean(recordType && recordId);
  const key = recordRevisionKey(recordType, recordId);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return;
    setRevision(readRecordRevision(window.localStorage, key));
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== key) return;
      setRevision(readRecordRevision(window.localStorage, key));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, enabled]);

  const bump = useCallback(() => {
    if (typeof window === 'undefined' || !enabled) return;
    const next = nextRecordRevision(readRecordRevision(window.localStorage, key), Date.now());
    window.localStorage.setItem(key, String(next));
    setRevision(next);
  }, [key, enabled]);

  return { revision, bump };
}
