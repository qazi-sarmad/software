/**
 * Design shapes (WP-D).
 *
 * A designer may drop a shape on the page: a rule, a rectangle, a rounded panel, an ellipse, a
 * callout box with text, or a divider. Shapes are PRESENTATION ONLY — a shape never states a fact —
 * and they are deterministic data, so the canvas, the PDF and the DOCX all draw the same shape.
 *
 * Pure: no clock, no randomness, no DOM.
 */
import { isHex } from './colourMath';

export const SHAPE_KINDS = ['rule', 'rect', 'panel', 'ellipse', 'callout', 'divider'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape's fill is either a theme colour name (resolved by the theme) or a hex value. */
export type ShapeFill = 'brand' | 'accent' | 'surface' | 'callout' | 'none' | string;

export interface ShapeSpec {
  id: string;
  kind: ShapeKind;
  /** The 1-based page the shape sits on. */
  page: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  fill: ShapeFill;
  /** A hex stroke colour, or `none` for a shape with no outline. */
  stroke: string;
  /** The stroke width in points; 0 draws no outline. */
  strokePt: number;
  /** The corner radius in millimetres (rounded rect/panel). */
  radiusMm: number;
  /** The text a callout prints; empty for every other kind. */
  text: string;
  /** Stacking order; a higher value draws later (on top). */
  z: number;
}

export const SHAPE_LIMITS = {
  textMaxLength: 200,
  sizeMm: { min: 1, max: 400 },
  radiusMm: { min: 0, max: 20 },
  strokePt: { min: 0, max: 12 },
} as const;

/** A shape's default size by kind, so a dropped shape appears with a sensible box. */
export function defaultShapeSize(kind: ShapeKind): { wMm: number; hMm: number } {
  switch (kind) {
    case 'rule': return { wMm: 80, hMm: 1 };
    case 'divider': return { wMm: 120, hMm: 4 };
    case 'ellipse': return { wMm: 40, hMm: 30 };
    case 'callout': return { wMm: 70, hMm: 24 };
    case 'panel': return { wMm: 80, hMm: 50 };
    case 'rect':
    default: return { wMm: 60, hMm: 30 };
  }
}

export function defaultShape(kind: ShapeKind, id: string, page: number, xMm: number, yMm: number, z: number): ShapeSpec {
  const { wMm, hMm } = defaultShapeSize(kind);
  return {
    id, kind, page, xMm, yMm, wMm, hMm,
    fill: kind === 'rule' || kind === 'divider' ? 'accent' : kind === 'callout' ? 'callout' : 'surface',
    stroke: kind === 'panel' || kind === 'rect' ? 'rule' : 'none',
    strokePt: kind === 'rule' ? 0 : 0.75,
    radiusMm: kind === 'panel' ? 3 : kind === 'callout' ? 2 : 0,
    text: kind === 'callout' ? 'Callout' : '',
    z,
  };
}

/** Whether a value is a shape kind. */
export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === 'string' && (SHAPE_KINDS as readonly string[]).includes(v);
}

/** The label a designer reads in the shape picker. */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rule: 'Rule',
  rect: 'Rectangle',
  panel: 'Panel',
  ellipse: 'Ellipse',
  callout: 'Callout',
  divider: 'Divider',
};

/**
 * Merge a stored shape onto the defaults, clamping every field, so a shape saved before a field
 * existed still yields a complete, valid shape. Pure; unknown keys are ignored.
 */
export function shapeFromRow(row: Record<string, unknown>, index: number): ShapeSpec {
  const kind = isShapeKind(row.kind) ? row.kind : 'rect';
  const base = defaultShape(kind, String(row.id ?? `shape-${index + 1}`), num(row.page, 1), num(row.xMm, 0), num(row.yMm, 0), num(row.z, index));
  const clampNum = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.min(Math.max(n, min), max);
  };
  const fill = typeof row.fill === 'string' && (row.fill === 'none' || isHex(row.fill) || /^(brand|accent|surface|callout)$/.test(row.fill))
    ? row.fill : base.fill;
  const stroke = typeof row.stroke === 'string' && (row.stroke === 'none' || isHex(row.stroke)) ? row.stroke : base.stroke;
  return {
    ...base,
    kind,
    page: Math.max(1, Math.round(clampNum(row.page, base.page, 1, 999))),
    xMm: clampNum(row.xMm, base.xMm, 0, SHAPE_LIMITS.sizeMm.max),
    yMm: clampNum(row.yMm, base.yMm, 0, SHAPE_LIMITS.sizeMm.max),
    wMm: clampNum(row.wMm, base.wMm, SHAPE_LIMITS.sizeMm.min, SHAPE_LIMITS.sizeMm.max),
    hMm: clampNum(row.hMm, base.hMm, SHAPE_LIMITS.sizeMm.min, SHAPE_LIMITS.sizeMm.max),
    fill,
    stroke,
    strokePt: clampNum(row.strokePt, base.strokePt, SHAPE_LIMITS.strokePt.min, SHAPE_LIMITS.strokePt.max),
    radiusMm: clampNum(row.radiusMm, base.radiusMm, SHAPE_LIMITS.radiusMm.min, SHAPE_LIMITS.radiusMm.max),
    text: typeof row.text === 'string' ? row.text.slice(0, SHAPE_LIMITS.textMaxLength) : base.text,
    z: Math.round(clampNum(row.z, base.z, 0, 9999)),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
