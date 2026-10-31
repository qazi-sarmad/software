/**
 * The design canvas model (WP-D): the geometry a designer's canvas draws.
 *
 * It takes the same page model the renderers print (`buildPages`) and converts it to pixels at a
 * chosen zoom, adding the grid lines, the ruler marks, the chrome strings and the resolved shapes.
 * One page model, so what the designer sees is what prints.
 *
 * Pure: no clock, no randomness, no DOM. The zoom is an argument, so the same input always yields
 * the same canvas.
 */
import type { DesignTheme } from './designTheme';
import { gridLines, rulerMarks, snapValue, snapWidth, type GridSpec } from './grid';
import {
  buildPages, mmToPtLocal, pageBlocks, pageShapes, pageSizeMm,
  type BlockBox, type ChromeSpec, type PageDesignInput, type ShapeBox,
} from './pageDesign';
import { fillTemplate } from '../render/branding';
import type { ShapeSpec } from './shapes';
import type { CrossReferenceSpec, HyperlinkSpec } from './links';
import { resolveReference, referenceTargets } from './links';
import type { DesignTheme as Theme } from './designTheme';

/** Pixels per millimetre at zoom 1 (a 96 dpi page shown 1:1 in CSS pixels). */
const PX_PER_MM = 96 / 25.4;

export const ZOOM_LIMITS = { min: 0.25, max: 2 } as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, Math.round(z * 100) / 100));
}

/** Millimetres to canvas pixels at a zoom. Rounded, so two renders of the same page match. */
export function mmToPx(mm: number, zoom = 1): number {
  return Math.round(mm * PX_PER_MM * zoom);
}

/** A block or shape on the canvas, in pixels. */
export interface CanvasItem {
  kind: 'block' | 'shape';
  id: string;
  label: string;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  /** The column the item flows in (1-based), or null when freely placed. */
  column: number | null;
  free: boolean;
  headingPx: number;
  bodyPx: number;
  lineHeight: number;
  headingWeight: number;
  bodyWeight: number;
  shape?: ShapeSpec;
}

export interface CanvasDesignPage {
  index: number;
  widthPx: number;
  heightPx: number;
  marginTopPx: number;
  marginLeftPx: number;
  contentXPx: number;
  contentYPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  columnWidthPx: number;
  columnGapPx: number;
  columns: number;
  /** Vertical grid lines inside the content box, in pixels from the page's left. */
  gridVertical: number[];
  /** Horizontal grid lines inside the content box, in pixels from the page's top. */
  gridHorizontal: number[];
  /** Ruler marks along the top, in pixels from the page's left. */
  rulerTop: number[];
  /** Ruler marks down the left, in pixels from the page's top. */
  rulerLeft: number[];
  items: CanvasItem[];
  /** The header and footer strings, already filled from the design's vars. */
  header: { left: string; centre: string; right: string };
  footer: { left: string; centre: string; right: string };
}

export interface DesignCanvasModel {
  zoom: number;
  grid: GridSpec;
  columns: number;
  theme: DesignTheme;
  typography: { headingPt: number; bodyPt: number; lineHeight: number; headingWeight: number; bodyWeight: number };
  pages: CanvasDesignPage[];
  pageCount: number;
  links: HyperlinkSpec[];
  references: { id: string; text: string; page: number | null }[];
  chrome: ChromeSpec;
}

export interface DesignCanvasInput extends PageDesignInput {
  zoom?: number;
  headingWeight?: number;
  bodyWeight?: number;
  links?: HyperlinkSpec[];
  crossReferences?: CrossReferenceSpec[];
  chromeVars?: Record<string, string | number>;
}

function toItem(box: BlockBox, zoom: number, typo: DesignCanvasModel['typography']): CanvasItem {
  return {
    kind: 'block', id: box.key, label: box.displayLabel,
    xPx: mmToPx(box.xMm, zoom), yPx: mmToPx(box.yMm, zoom),
    wPx: mmToPx(box.wMm, zoom), hPx: mmToPx(box.hMm, zoom),
    column: box.column, free: box.free,
    headingPx: Math.round(typo.headingPt), bodyPx: Math.round(typo.bodyPt), lineHeight: typo.lineHeight,
    headingWeight: typo.headingWeight, bodyWeight: typo.bodyWeight,
  };
}

function shapeItem(box: ShapeBox, zoom: number, typo: DesignCanvasModel['typography']): CanvasItem {
  return {
    kind: 'shape', id: box.shape.id, label: box.shape.text || box.shape.kind,
    xPx: mmToPx(box.xMm, zoom), yPx: mmToPx(box.yMm, zoom),
    wPx: mmToPx(box.wMm, zoom), hPx: mmToPx(box.hMm, zoom),
    column: null, free: true,
    headingPx: 0, bodyPx: Math.round(typo.bodyPt), lineHeight: 1,
    headingWeight: typo.headingWeight, bodyWeight: typo.bodyWeight,
    shape: box.shape,
  };
}

/** Build the canvas model the designer draws. Pure. */
export function buildDesignCanvas(input: DesignCanvasInput): DesignCanvasModel {
  const zoom = clampZoom(input.zoom ?? 1);
  const typography = {
    ...input.typography,
    headingWeight: input.headingWeight ?? 600,
    bodyWeight: input.bodyWeight ?? 400,
  };
  const pages = buildPages(input);
  const vars = input.chromeVars ?? {};
  const grid = input.grid;

  const canvasPages: CanvasDesignPage[] = pages.pages.map((p) => {
    const items: CanvasItem[] = [
      ...pageBlocks(p).map((b) => toItem(b, zoom, typography)),
      ...pageShapes(p).map((s) => shapeItem(s, zoom, typography)),
    ];
    const localVars = { ...vars, page: p.index, pages: pages.pageCount };
    return {
      index: p.index,
      widthPx: mmToPx(p.widthMm, zoom),
      heightPx: mmToPx(p.heightMm, zoom),
      marginTopPx: mmToPx(p.marginTopMm, zoom),
      marginLeftPx: mmToPx(p.marginLeftMm, zoom),
      contentXPx: mmToPx(p.contentXMm, zoom),
      contentYPx: mmToPx(p.contentYMm, zoom),
      contentWidthPx: mmToPx(p.contentWidthMm, zoom),
      contentHeightPx: mmToPx(p.contentHeightMm, zoom),
      columnWidthPx: mmToPx(p.columnWidthMm, zoom),
      columnGapPx: mmToPx(p.columnGapMm, zoom),
      columns: p.columns,
      gridVertical: gridLines(p.contentWidthMm, grid).map((v) => mmToPx(v, zoom)),
      gridHorizontal: gridLines(p.contentHeightMm, grid).map((v) => mmToPx(v, zoom)),
      rulerTop: rulerMarks(p.widthMm, grid).map((v) => mmToPx(v, zoom)),
      rulerLeft: rulerMarks(p.heightMm, grid).map((v) => mmToPx(v, zoom)),
      items,
      header: {
        left: fillTemplate(input.chrome.headerLeft, localVars),
        centre: fillTemplate(input.chrome.headerCentre, localVars),
        right: fillTemplate(input.chrome.headerRight, localVars),
      },
      footer: {
        left: fillTemplate(input.chrome.footerLeft, localVars),
        centre: fillTemplate(input.chrome.footerCentre, localVars),
        right: fillTemplate(input.chrome.footerRight, localVars),
      },
    };
  });

  // Cross-references resolve against the pages the targets actually landed on.
  const boxes = pages.pages.flatMap((p) => pageBlocks(p).map((b) => ({ key: b.key, label: b.displayLabel, page: p.index })));
  const targets = referenceTargets(boxes, []);
  const references = (input.crossReferences ?? []).map((ref) => {
    const r = resolveReference(ref, targets);
    return { id: ref.id, text: r.text, page: r.page };
  });

  return {
    zoom, grid, columns: pages.columns, theme: pages.theme, typography,
    pages: canvasPages, pageCount: pages.pageCount,
    links: input.links ?? [], references, chrome: input.chrome,
  };
}

/** Snap a drag position in pixels to the grid, returning the millimetre value the model stores. */
export function snapPxToMm(px: number, zoom: number, grid: GridSpec): number {
  const mm = px / (PX_PER_MM * zoom);
  return snapValue(mm, grid);
}

/** Snap a resized width in pixels to the grid, in millimetres, never below one step. */
export function snapWidthPxToMm(px: number, zoom: number, grid: GridSpec): number {
  const mm = px / (PX_PER_MM * zoom);
  return snapWidth(mm, grid);
}

/** A stable test id for an item on the canvas. */
export function itemTestId(prefix: string, item: CanvasItem): string {
  return `${prefix}-${item.kind}-${item.id}`;
}

/** The theme, re-exported so the component imports one module. */
export type { Theme };
