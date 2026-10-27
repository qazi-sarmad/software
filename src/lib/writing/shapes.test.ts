import { describe, expect, it } from 'vitest';
import {
  SHAPE_KINDS, SHAPE_LABELS, defaultShape, defaultShapeSize, isShapeKind, shapeFromRow,
} from './shapes';

describe('shapes', () => {
  it('offers every kind with a label and a default size', () => {
    for (const k of SHAPE_KINDS) {
      expect(SHAPE_LABELS[k]).toBeTruthy();
      const s = defaultShapeSize(k);
      expect(s.wMm).toBeGreaterThan(0);
      expect(s.hMm).toBeGreaterThan(0);
    }
  });

  it('builds a default shape that is deterministic', () => {
    expect(defaultShape('callout', 'c1', 1, 10, 20, 3)).toEqual(defaultShape('callout', 'c1', 1, 10, 20, 3));
    expect(defaultShape('callout', 'c1', 1, 10, 20, 3).text).toBe('Callout');
    expect(defaultShape('rule', 'r1', 1, 0, 0, 0).fill).toBe('accent');
  });

  it('recognises shape kinds only', () => {
    expect(isShapeKind('panel')).toBe(true);
    expect(isShapeKind('triangle')).toBe(false);
    expect(isShapeKind(null)).toBe(false);
  });

  it('merges a stored row, clamping every field and defaulting the rest', () => {
    const s = shapeFromRow({ kind: 'rect', xMm: 9999, yMm: -4, wMm: 0, hMm: 12, fill: '#123456', z: 5 }, 0);
    expect(s.kind).toBe('rect');
    expect(s.xMm).toBe(400); // clamped to the max
    expect(s.yMm).toBe(0);
    expect(s.wMm).toBe(1); // clamped to the min
    expect(s.hMm).toBe(12);
    expect(s.fill).toBe('#123456');
    expect(s.z).toBe(5);
  });

  it('falls back to a defined shape for an unknown kind and unknown fill', () => {
    const s = shapeFromRow({ kind: 'hexagon', fill: 'chartreuse' }, 2);
    expect(s.kind).toBe('rect');
    expect(s.fill).toBe(defaultShape('rect', s.id, 1, 0, 0, 0).fill);
    expect(s.id).toBe('shape-3');
  });
});
