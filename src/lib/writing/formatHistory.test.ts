import { describe, expect, it } from 'vitest';
import {
  canRedo, canUndo, initHistory, moveItem, pushHistory, redo, undo,
} from './formatHistory';

describe('WP-C2 the format editor undo/redo history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory('a');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe('a');
  });

  it('undo steps back and redo steps forward through the edits', () => {
    let h = initHistory('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    expect(h.present).toBe('c');
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toBe('b');
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('a fresh edit after an undo clears the redo stack', () => {
    let h = initHistory('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, 'd');
    expect(h.present).toBe('d');
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual(['a', 'b']);
  });

  it('undo and redo at the ends are no-ops, never errors', () => {
    const h = initHistory('a');
    expect(undo(h)).toEqual(h);
    expect(redo(h)).toEqual(h);
  });

  it('the history is bounded: old edits fall off the bottom', () => {
    let h = initHistory(0, 3);
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i);
    expect(h.present).toBe(10);
    expect(h.past.length).toBe(3);
    expect(h.past).toEqual([7, 8, 9]);
  });

  it('moveItem reorders a list, and out-of-range moves leave it unchanged', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    // The original list is never mutated.
    const original = ['a', 'b', 'c'];
    moveItem(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
  });
});
