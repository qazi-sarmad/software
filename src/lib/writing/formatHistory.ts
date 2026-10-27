/**
 * Undo/redo for the report-format editor (WP-C2). A pure, bounded history of draft snapshots: the
 * editor pushes a snapshot before each change, and undo/redo move the cursor. Deterministic — no
 * clock, no randomness — so the same sequence of edits always yields the same history.
 *
 * Snapshots are shallow-frozen by the caller; this module never mutates a snapshot in place.
 */
export interface History<T> {
  /** Past states, oldest first. The current state is `present`. */
  past: T[];
  present: T;
  future: T[];
  /** The most edits kept. Older edits fall off the bottom so memory stays bounded. */
  limit: number;
}

/** Start a history at an initial state. */
export function initHistory<T>(present: T, limit = 50): History<T> {
  return { past: [], present, future: [], limit };
}

/** Record a new present state. This clears the redo stack, as a fresh edit does. */
export function pushHistory<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present];
  const trimmed = past.length > history.limit ? past.slice(past.length - history.limit) : past;
  return { ...history, past: trimmed, present: next, future: [] };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const next = history.future[0];
  return {
    ...history,
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

/**
 * Move an item within a list from one index to another, returning a new list. Used by the canvas'
 * drag-and-drop: dropping a block onto a new slot reorders the format. Out-of-range indices leave the
 * list unchanged, so a stray drop event can never corrupt the order.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
