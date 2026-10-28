import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { explainFor, type ExplainContext, type ExplainView } from '../lib/explain/catalogue';

/**
 * Resolve an explain view for the signed-in user (docs/EXPLAIN-LAYER.md §3).
 *
 * The hook is the ONLY way a component reaches the layer, so the caller's identity is always the
 * live session and the popout can never be handed a different one. `context` carries only values the
 * host screen has ALREADY filtered through src/lib/access.ts — the popout never queries.
 *
 * Returns `{ view, open, pinned, openDetail, closeDetail, togglePin }`: `view` is the resolved,
 * redacted catalogue entry; the rest drive the hover card -> detail panel -> pinned transitions.
 */
export interface UseExplainResult {
  view: ExplainView;
  /** Whether the detail panel is open. */
  open: boolean;
  /** Whether the detail panel is pinned (stays open beside the work). */
  pinned: boolean;
  openDetail: () => void;
  closeDetail: () => void;
  togglePin: () => void;
}

export function useExplain(explainId: string, context?: ExplainContext): UseExplainResult {
  const { currentUser } = useApp();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);

  const contextKey = JSON.stringify(context?.values ?? []);
  const view = useMemo(
    () => explainFor(currentUser, explainId, context),
    // The context is plain data; the id plus the values' content and `now` are the dependencies.
    [currentUser, explainId, contextKey, context?.now]
  );

  const openDetail = useCallback(() => setOpen(true), []);
  const closeDetail = useCallback(() => {
    setOpen(false);
    setPinned(false);
  }, []);
  // Pinning keeps the panel open; unpinning leaves it open (the user can still close it).
  const togglePin = useCallback(() => setPinned((p) => !p), []);

  return { view, open, pinned, openDetail, closeDetail, togglePin };
}
