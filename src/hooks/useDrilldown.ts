import { useCallback, useEffect, useState } from 'react';
import { drillHash, parseDrillHash, type DrillKind, type DrillTarget } from '../lib/drilldown';

/**
 * Drilldown state with a shareable deep link (E5, U1; docs/EXPLAIN-LAYER.md §4).
 *
 * The open drilldown is mirrored into the URL hash (`#drill=<kind>`), so a state can be shared and
 * re-opened, and it is restored on load. The hash carries only the family name — never a tenant id —
 * so a deep link leaks nothing and re-resolves against the current session's scoped rows.
 */
export interface UseDrilldownResult {
  target: DrillTarget | null;
  open: (target: DrillTarget) => void;
  close: () => void;
}

export function useDrilldown(): UseDrilldownResult {
  const [target, setTarget] = useState<DrillTarget | null>(() =>
    typeof window === 'undefined' ? null : parseDrillHash(window.location.hash)
  );

  useEffect(() => {
    const onHashChange = () => setTarget(parseDrillHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const open = useCallback((next: DrillTarget) => {
    setTarget(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', drillHash(next));
    }
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  return { target, open, close };
}

/** The kinds a deep link may restore, for callers that want to validate before rendering. */
export type { DrillKind };
