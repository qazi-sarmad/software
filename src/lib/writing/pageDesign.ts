/**
 * The page-design model (WP-D): the geometry behind the report designer.
 *
 * One pure function turns a report format's page setup, grid, chrome, columns, shapes and placed
 * blocks into the pages a canvas draws and the PDF/DOCX renderers print. It is the single source of
 * layout for every output, so the designer's preview and the printed page are the same geometry.
 *
 * Determinism: no clock, no randomness, no DOM. The same input always yields the same pages. A block
 * either flows (into a column, in order) or is placed freely at an x/y the designer chose; a free
 * block is snapped to the grid at the model boundary, so the model never holds a half-step value.
 */
import { pageDimensions } from '../render/branding';
import type { DesignTheme } from './designTheme';
import { snapValue, type GridSpec } from './grid';
import type { ShapeSpec } from './shapes';

export const PAGE_SETUP_LIMITS = {
  marginMm: { min: 0, max: 60 },
  columns: { min: 1, max: 3 },
  columnGapMm: { min: 0, max: 30 },
} as const;

export interface PageSetup {
  pageSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

export type { GridSpec } from './grid';

/** The header and footer (WP-D). Each side takes the same `{var}` templates the renderers already
 *  fill, so a designer can print the engagement, the page number or the classification. */
export interface ChromeSpec {
  headerEnabled: boolean;
  headerLeft: string;
  headerCentre: string;
  headerRight: string;
  footerEnabled: boolean;
  footerLeft: string;
  footerCentre: string;
  footerRight: string;
  /** A hairline under the header and above the footer. */
  rule: boolean;
  /** Print the header/footer on the cover page too. */
  onFirstPage: boolean;
  /** How the page number is printed; `none` prints no number. */
  pageNumber: PageNumberStyle;
}

export const PAGE_NUMBER_STYLES = ['none', 'n', 'page-n', 'n-of-total', 'page-n-of-total'] as const;
export type PageNumberStyle = (typeof PAGE_NUMBER_STYLES)[number];

export const DEFAULT_CHROME: ChromeSpec = {
  headerEnabled: true,
  headerLeft: '',
  headerCentre: '{engagement}',
  headerRight: '{classification}',
  footerEnabled: true,
  footerLeft: '{org}',
  footerCentre: '',
  footerRight: 'Page {page} of {pages}',
  rule: true,
  onFirstPage: false,
  pageNumber: 'page-n-of-total',
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  pageSize: 'A4',
  orientation: 'portrait',
  marginTopMm: 20,
  marginRightMm: 20,
  marginBottomMm: 20,
  marginLeftMm: 20,
};

/** How one format block is placed. A null x/y means the block flows; a number means free placement. */
export interface PlacedBlock {
  key: string;
  /** The 1-based page a free block sits on. Ignored for a flowing block. */
  page: number;
  /** The 1-based column a flowing block prefers. Ignored for a free block. */
  column: number;
  xMm: number | null;
  yMm: number | null;
  /** The block's width in millimetres. Zero means the full column width. */
  wMm: number;
}

export function defaultPlacedBlock(key: string): PlacedBlock {
  return { key, page: 1, column: 1, xMm: null, yMm: null, wMm: 0 };
}

/** The block input the page model needs: the geometry depends on the text, not on the facts. */
export interface BlockGeometry {
  key: string;
  label: string;
  /** The number of body lines the block holds, for the height estimate. */
  bodyLines: number;
}

export interface PageDesignInput {
  setup: PageSetup;
  grid: GridSpec;
  chrome: ChromeSpec;
  columns: number;
  columnGapMm: number;
  theme: DesignTheme;
  /** The resolved print typography, in points. */
  typography: { headingPt: number; bodyPt: number; lineHeight: number };
  /** The visible blocks, in the format's order. */
  blocks: BlockGeometry[];
  placed: PlacedBlock[];
  shapes: ShapeSpec[];
  /** Whether each section heading is numbered (`1. Scope`). */
  numberedHeadings: boolean;
}

/** A block after layout: its page and its box in millimetres. */
export interface BlockBox {
  kind: 'block';
  key: string;
  label: string;
  displayLabel: string;
  page: number;
  column: number | null;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  free: boolean;
}

/** A shape after layout: its page and its box in millimetres. */
export interface ShapeBox {
  kind: 'shape';
  shape: ShapeSpec;
  page: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export type PlacedItem = BlockBox | ShapeBox;

export interface PageBox {
  /** 1-based page number. */
  index: number;
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  contentXMm: number;
  contentYMm: number;
  contentWidthMm: number;
  contentHeightMm: number;
  columnWidthMm: number;
  columnGapMm: number;
  columns: number;
  items: PlacedItem[];
}

export interface PageModel {
  setup: PageSetup;
  grid: GridSpec;
  chrome: ChromeSpec;
  theme: DesignTheme;
  columns: number;
  columnGapMm: number;
  typography: { headingPt: number; bodyPt: number; lineHeight: number };
  pages: PageBox[];
  pageCount: number;
  /** True when the flowing content needed more than the first page. */
  overflowsFirstPage: boolean;
}

const PT_PER_MM = 72 / 25.4;

/** Millimetres to points. */
export function mmToPtLocal(mm: number): number {
  return mm * PT_PER_MM;
}

/** Points to millimetres. */
export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}

/** Page width and height in millimetres, honouring the orientation. */
export function pageSizeMm(setup: PageSetup): { widthMm: number; heightMm: number } {
  const d = pageDimensions(setup.pageSize);
  const w = d.widthIn * 25.4;
  const h = d.heightIn * 25.4;
  return setup.orientation === 'landscape' ? { widthMm: h, heightMm: w } : { widthMm: w, heightMm: h };
}

/**
 * The estimated height of a block in millimetres: its heading, its body lines at the resolved size
 * and line height, and the block's own spacing. The estimate is what the canvas shows and what the
 * paginator uses, so the two agree.
 */
export function blockHeightMm(
  headingPt: number, bodyPt: number, lineHeight: number, bodyLines: number, numbered: boolean,
): number {
  const heading = ptToMm(headingPt * 1.25) + (numbered ? 0 : 0);
  const body = bodyLines > 0 ? ptToMm(bodyPt * lineHeight * bodyLines) : 0;
  return round2(heading + body + 6);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The width of one column, given the content width, the column count and the gap. */
export function columnWidthMm(contentWidthMm: number, columns: number, gapMm: number): number {
  const cols = Math.max(1, Math.min(3, Math.round(columns)));
  const usable = contentWidthMm - gapMm * (cols - 1);
  return round2(Math.max(0, usable / cols));
}

/** The x offset of a 1-based column within the content box. */
export function columnOffsetMm(column: number, width: number, gapMm: number): number {
  return round2((Math.max(1, column) - 1) * (width + gapMm));
}

function blankPage(index: number, setup: PageSetup, columns: number, gapMm: number): PageBox {
  const { widthMm, heightMm } = pageSizeMm(setup);
  const contentWidthMm = round2(widthMm - setup.marginLeftMm - setup.marginRightMm);
  const contentHeightMm = round2(heightMm - setup.marginTopMm - setup.marginBottomMm);
  return {
    index,
    widthMm, heightMm,
    marginTopMm: setup.marginTopMm, marginRightMm: setup.marginRightMm,
    marginBottomMm: setup.marginBottomMm, marginLeftMm: setup.marginLeftMm,
    contentXMm: setup.marginLeftMm, contentYMm: setup.marginTopMm,
    contentWidthMm, contentHeightMm,
    columnWidthMm: columnWidthMm(contentWidthMm, columns, gapMm),
    columnGapMm: gapMm, columns,
    items: [],
  };
}

/**
 * Lay a format out into pages. Pure and total: the same input always yields the same pages.
 *
 * Flowing blocks fill column 1 top to bottom, then column 2, and so on; when the last column of a
 * page is full, the flow continues on a new page. A free block (with an x and a y) is placed
 * absolutely on its own page and is snapped to the grid; a shape is always absolute. Free blocks and
 * shapes do not consume flow space, so dragging one never re-flows the text.
 */
export function buildPages(input: PageDesignInput): PageModel {
  const { setup, grid, chrome, theme, typography, blocks, placed, shapes, numberedHeadings } = input;
  const columns = Math.max(PAGE_SETUP_LIMITS.columns.min, Math.min(PAGE_SETUP_LIMITS.columns.max, Math.round(input.columns)));
  const gapMm = Math.max(0, input.columnGapMm);
  const byKey = new Map(placed.map((p) => [p.key, p]));
  const shapePage = new Map<string, number>();

  const pages: PageBox[] = [];
  const ensure = (n: number): PageBox => {
    while (pages.length < n) pages.push(blankPage(pages.length + 1, setup, columns, gapMm));
    return pages[n - 1];
  };

  ensure(1);
  // The flow cursor: which page, which column, and how far down the column.
  let pageNo = 1;
  let col = 0;
  let y = setup.marginTopMm;
  let flowUsed = false;

  const page0 = ensure(1);
  const step = (h: number): number => h + 3; // the gap between two flowed blocks

  blocks.forEach((b, i) => {
    const placement = byKey.get(b.key) ?? defaultPlacedBlock(b.key);
    const displayLabel = numberedHeadings ? `${i + 1}. ${b.label}` : b.label;
    const hMm = blockHeightMm(typography.headingPt, typography.bodyPt, typography.lineHeight, b.bodyLines, numberedHeadings);
    const isFree = placement.xMm !== null && placement.yMm !== null;
    const wMm = placement.wMm > 0
      ? placement.wMm
      : page0.columnWidthMm;

    if (isFree) {
      const p = ensure(Math.max(1, Math.round(placement.page)));
      p.items.push({
        kind: 'block', key: b.key, label: b.label, displayLabel,
        page: p.index, column: null,
        xMm: snapValue(Math.max(0, placement.xMm!), grid),
        yMm: snapValue(Math.max(0, placement.yMm!), grid),
        wMm: round2(Math.max(10, wMm)), hMm, free: true,
      });
      return;
    }

    flowUsed = true;
    // Advance the flow cursor until the block fits, wrapping columns then pages.
    for (let guard = 0; guard < 10000; guard += 1) {
      const page = ensure(pageNo);
      const bottom = page.contentYMm + page.contentHeightMm;
      if (y + hMm <= bottom + 0.01) {
        page.items.push({
          kind: 'block', key: b.key, label: b.label, displayLabel,
          page: pageNo, column: col + 1,
          xMm: round2(page.contentXMm + columnOffsetMm(col + 1, page.columnWidthMm, gapMm)),
          yMm: round2(y),
          wMm: round2(Math.min(wMm, page.columnWidthMm)), hMm, free: false,
        });
        y += step(hMm);
        return;
      }
      col += 1;
      if (col >= columns) { col = 0; pageNo += 1; }
      y = ensure(pageNo).contentYMm;
    }
  });

  // Shapes are absolute, on the page the designer chose.
  for (const shape of shapes) {
    const p = ensure(Math.max(1, Math.round(shape.page ?? 1)));
    const x = snapValue(Math.max(0, shape.xMm), grid);
    const y = snapValue(Math.max(0, shape.yMm), grid);
    p.items.push({ kind: 'shape', shape, page: p.index, xMm: x, yMm: y, wMm: round2(shape.wMm), hMm: round2(shape.hMm) });
    shapePage.set(shape.id, p.index);
  }

  const maxPage = pages.length;
  return {
    setup, grid, chrome, theme, columns, columnGapMm: gapMm, typography,
    pages,
    pageCount: maxPage,
    overflowsFirstPage: flowUsed && maxPage > 1,
  };
}

/** The blocks on a page, in reading order (column, then y). Used by the renderers. */
export function pageBlocks(page: PageBox): BlockBox[] {
  return page.items
    .filter((i): i is BlockBox => i.kind === 'block')
    .sort((a, z) => (a.column ?? 0) - (z.column ?? 0) || a.yMm - z.yMm);
}

/** The shapes on a page, in the designer's own stacking order (lowest z first). */
export function pageShapes(page: PageBox): ShapeBox[] {
  return page.items
    .filter((i): i is ShapeBox => i.kind === 'shape')
    .sort((a, z) => a.shape.z - z.shape.z);
}
