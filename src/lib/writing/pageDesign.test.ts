import { describe, expect, it } from 'vitest';
import {
  buildPages, blockHeightMm, columnOffsetMm, columnWidthMm, defaultPlacedBlock, mmToPtLocal, pageSizeMm,
  pageBlocks, pageShapes, ptToMm, type PageDesignInput,
} from './pageDesign';
import { DEFAULT_GRID } from './grid';
import { DEFAULT_CHROME, DEFAULT_PAGE_SETUP } from './pageDesign';
import { deriveTheme, defaultThemeInput, type ResolvedBranding } from './designTheme';
import { defaultShape } from './shapes';

const branding: ResolvedBranding = { primary: '#2f6f5e', accent: '#c9a227', text: '#14161b', background: '#ffffff' };
const theme = deriveTheme(defaultThemeInput(), branding);

const input = (over: Partial<PageDesignInput> = {}): PageDesignInput => ({
  setup: { ...DEFAULT_PAGE_SETUP },
  grid: { ...DEFAULT_GRID },
  chrome: { ...DEFAULT_CHROME },
  columns: 1,
  columnGapMm: 6,
  theme,
  typography: { headingPt: 15, bodyPt: 11, lineHeight: 1.4 },
  blocks: [{ key: 'a', label: 'Scope', bodyLines: 6 }, { key: 'b', label: 'Criteria', bodyLines: 6 }],
  placed: [defaultPlacedBlock('a'), defaultPlacedBlock('b')],
  shapes: [],
  numberedHeadings: true,
  ...over,
});

describe('page geometry', () => {
  it('converts mm and pt both ways, round-tripping', () => {
    expect(mmToPtLocal(25.4)).toBeCloseTo(72, 6);
    expect(ptToMm(72)).toBeCloseTo(25.4, 6);
    expect(ptToMm(mmToPtLocal(40))).toBeCloseTo(40, 6);
  });

  it('honours the orientation when computing the page size', () => {
    const p = pageSizeMm({ ...DEFAULT_PAGE_SETUP, orientation: 'portrait' });
    const l = pageSizeMm({ ...DEFAULT_PAGE_SETUP, orientation: 'landscape' });
    expect(p.widthMm).toBeLessThan(p.heightMm);
    expect(l.widthMm).toBeCloseTo(p.heightMm, 6);
    expect(l.heightMm).toBeCloseTo(p.widthMm, 6);
  });

  it('divides the content box into columns with a gap', () => {
    expect(columnWidthMm(170, 1, 6)).toBe(170);
    expect(columnWidthMm(170, 2, 6)).toBe(82);
    expect(columnOffsetMm(1, 82, 6)).toBe(0);
    expect(columnOffsetMm(2, 82, 6)).toBe(88);
  });

  it('estimates a taller block for more body lines', () => {
    const one = blockHeightMm(15, 11, 1.4, 1, true);
    const many = blockHeightMm(15, 11, 1.4, 20, true);
    expect(many).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(0);
  });
});

describe('buildPages', () => {
  it('flows blocks down the first column and numbers the headings', () => {
    const m = buildPages(input());
    expect(m.pageCount).toBe(1);
    const boxes = pageBlocks(m.pages[0]);
    expect(boxes.map((b) => b.key)).toEqual(['a', 'b']);
    expect(boxes[0].displayLabel).toBe('1. Scope');
    expect(boxes[1].displayLabel).toBe('2. Criteria');
    expect(boxes[0].column).toBe(1);
    expect(boxes[0].free).toBe(false);
  });

  it('omits the heading number when numbering is off', () => {
    const m = buildPages(input({ numberedHeadings: false }));
    expect(pageBlocks(m.pages[0])[0].displayLabel).toBe('Scope');
  });

  it('fills the first column before the second', () => {
    // Two columns and enough lines that only one block fits per column at this height.
    const blocks = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, label: `S${i}`, bodyLines: 40 }));
    const m = buildPages(input({ columns: 2, blocks, placed: blocks.map((b) => defaultPlacedBlock(b.key)) }));
    const first = m.pages[0];
    const boxes = pageBlocks(first);
    const col1 = boxes.filter((b) => b.column === 1);
    const col2 = boxes.filter((b) => b.column === 2);
    expect(col1.length).toBeGreaterThan(0);
    expect(col1[0].yMm).toBe(first.contentYMm);
    if (col2.length) expect(col2[0].xMm).toBeGreaterThan(col1[0].xMm);
  });

  it('starts a new page when the columns are full, and flags the overflow', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, label: `S${i}`, bodyLines: 20 }));
    const m = buildPages(input({ columns: 1, blocks, placed: blocks.map((b) => defaultPlacedBlock(b.key)) }));
    expect(m.pageCount).toBeGreaterThan(1);
    expect(m.overflowsFirstPage).toBe(true);
  });

  it('places a free block at its snapped x/y on its own page, consuming no flow space', () => {
    const placed = [
      defaultPlacedBlock('a'),
      { ...defaultPlacedBlock('b'), xMm: 63, yMm: 82, page: 2, wMm: 40 },
    ];
    const m = buildPages(input({ grid: { ...DEFAULT_GRID, snap: true, sizeMm: 5 }, placed }));
    const page2 = m.pages[1];
    const free = pageBlocks(page2).find((b) => b.key === 'b')!;
    expect(free.free).toBe(true);
    expect(free.xMm).toBe(65); // 63 snapped to the nearest 5
    expect(free.yMm).toBe(80);
    expect(free.wMm).toBe(40);
    // The flowed block 'a' is unaffected by the free one.
    expect(pageBlocks(m.pages[0]).find((b) => b.key === 'a')!.yMm).toBe(m.pages[0].contentYMm);
  });

  it('snaps a free block when snapping is on, and leaves it when off', () => {
    const placed = [{ ...defaultPlacedBlock('a'), xMm: 63, yMm: 82 }];
    const on = buildPages(input({ grid: { ...DEFAULT_GRID, snap: true, sizeMm: 5 }, placed }));
    const off = buildPages(input({ grid: { ...DEFAULT_GRID, snap: false }, placed }));
    expect(pageBlocks(on.pages[0])[0].xMm).toBe(65);
    expect(pageBlocks(off.pages[0])[0].xMm).toBe(63);
  });

  it('places shapes absolutely, in z order', () => {
    const shapes = [
      defaultShape('rect', 's2', 1, 20, 20, 2),
      defaultShape('rule', 's1', 1, 10, 10, 1),
    ];
    const m = buildPages(input({ shapes }));
    const drawn = pageShapes(m.pages[0]);
    expect(drawn.map((s) => s.shape.id)).toEqual(['s1', 's2']);
    expect(drawn[0].xMm).toBe(10);
  });

  it('is deterministic: the same input always yields the same pages', () => {
    const a = buildPages(input());
    const b = buildPages(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
