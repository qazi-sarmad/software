import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID, gridLines, nearestGridLine, rulerMarks, snapValue, snapWidth, type GridSpec } from './grid';

const grid = (over: Partial<GridSpec> = {}): GridSpec => ({ ...DEFAULT_GRID, ...over });

describe('grid snapping', () => {
  it('snaps a value to the nearest step', () => {
    const g = grid({ snap: true, sizeMm: 5 });
    expect(snapValue(0, g)).toBe(0);
    expect(snapValue(2.4, g)).toBe(0);
    expect(snapValue(2.6, g)).toBe(5);
    expect(snapValue(12.5, g)).toBe(15);
    expect(snapValue(-2.6, g)).toBe(-5);
  });

  it('returns the value unchanged (rounded) when snapping is off', () => {
    expect(snapValue(12.345, grid({ snap: false }))).toBe(12.35);
    expect(snapValue(7.77, grid({ snap: true, sizeMm: 0 }))).toBe(7.77);
    expect(snapValue(7.77, grid({ snap: true, sizeMm: Number.NaN }))).toBe(7.77);
  });

  it('is idempotent: snapping a snapped value changes nothing', () => {
    const g = grid({ sizeMm: 3 });
    for (const v of [0, 1, 3, 4.5, 30, 99.9]) {
      const once = snapValue(v, g);
      expect(snapValue(once, g)).toBe(once);
    }
  });

  it('never snaps a width below one step', () => {
    const g = grid({ sizeMm: 5 });
    expect(snapWidth(0, g)).toBe(5);
    expect(snapWidth(3, g)).toBe(5);
    expect(snapWidth(12, g)).toBe(10);
  });

  it('lists grid lines and ruler marks within a span, and none when hidden', () => {
    expect(gridLines(12, grid({ visible: true, sizeMm: 5 }))).toEqual([5, 10]);
    expect(gridLines(12, grid({ visible: false, sizeMm: 5 }))).toEqual([]);
    expect(rulerMarks(10, grid({ rulers: true, sizeMm: 5, subdivisions: 2 }))).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(rulerMarks(10, grid({ rulers: false }))).toEqual([]);
  });

  it('finds the nearest grid line', () => {
    const g = grid({ sizeMm: 4 });
    expect(nearestGridLine(6, g)).toBe(8);
    expect(nearestGridLine(5, g)).toBe(4);
  });
});
