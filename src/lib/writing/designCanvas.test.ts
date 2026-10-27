import { describe, expect, it } from 'vitest';
import {
  buildDesignCanvas, clampZoom, itemTestId, mmToPx, snapPxToMm, snapWidthPxToMm, type DesignCanvasInput,
} from './designCanvas';
import { DEFAULT_GRID } from './grid';
import { DEFAULT_CHROME, DEFAULT_PAGE_SETUP, defaultPlacedBlock } from './pageDesign';
import { deriveTheme, defaultThemeInput, type ResolvedBranding } from './designTheme';
import { defaultShape } from './shapes';

const branding: ResolvedBranding = { primary: '#2f6f5e', accent: '#c9a227', text: '#14161b', background: '#ffffff' };
const theme = deriveTheme(defaultThemeInput(), branding);

const input = (over: Partial<DesignCanvasInput> = {}): DesignCanvasInput => ({
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
  numberedHeadings: false,
  zoom: 1,
  chromeVars: { org: 'Acme', engagement: 'FY24' },
  ...over,
});

describe('design canvas', () => {
  it('clamps the zoom to the allowed range', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('converts millimetres to pixels at the zoom', () => {
    expect(mmToPx(25.4, 1)).toBe(96);
    expect(mmToPx(25.4, 0.5)).toBe(48);
    expect(mmToPx(25.4, 2)).toBe(192);
  });

  it('draws one page per paginated page, with rulers and a grid', () => {
    const m = buildDesignCanvas(input());
    expect(m.pageCount).toBe(1);
    const p = m.pages[0];
    expect(p.rulerTop.length).toBeGreaterThan(0);
    expect(p.gridHorizontal.length).toBeGreaterThan(0);
    expect(p.items.filter((i) => i.kind === 'block')).toHaveLength(2);
  });

  it('fills the header and footer templates from the chrome vars', () => {
    const m = buildDesignCanvas(input({
      chrome: { ...DEFAULT_CHROME, headerEnabled: true, footerEnabled: true, headerCentre: '{engagement}', footerLeft: '{org}' },
    }));
    expect(m.pages[0].header.centre).toBe('FY24');
    expect(m.pages[0].footer.left).toBe('Acme');
  });

  it('reports the page count in the footer template', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, label: `S${i}`, bodyLines: 20 }));
    const m = buildDesignCanvas(input({
      blocks, placed: blocks.map((b) => defaultPlacedBlock(b.key)),
      chrome: { ...DEFAULT_CHROME, footerEnabled: true, footerRight: 'Page {page} of {pages}' },
    }));
    expect(m.pageCount).toBeGreaterThan(1);
    expect(m.pages[0].footer.right).toBe(`Page 1 of ${m.pageCount}`);
  });

  it('renders a shape as a canvas item', () => {
    const m = buildDesignCanvas(input({ shapes: [defaultShape('rect', 's1', 1, 20, 20, 1)] }));
    const shapes = m.pages[0].items.filter((i) => i.kind === 'shape');
    expect(shapes).toHaveLength(1);
    expect(shapes[0].id).toBe('s1');
  });

  it('resolves cross-references to the target page', () => {
    const m = buildDesignCanvas(input({ crossReferences: [{ id: 'r1', kind: 'heading', targetKey: 'a', label: 'see' }] }));
    expect(m.references[0].text).toBe('see Scope, page 1');
    expect(m.references[0].page).toBe(1);
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildDesignCanvas(input()))).toBe(JSON.stringify(buildDesignCanvas(input())));
  });

  it('snaps a dragged pixel position to the grid in millimetres', () => {
    const grid = { ...DEFAULT_GRID, snap: true, sizeMm: 5 };
    // 100 px at zoom 1 = 26.46 mm; snapped to the nearest 5 = 25.
    expect(snapPxToMm(100, 1, grid)).toBe(25);
    expect(snapWidthPxToMm(40, 1, grid)).toBe(10);
  });

  it('builds a stable test id per item', () => {
    const m = buildDesignCanvas(input());
    const item = m.pages[0].items[0];
    expect(itemTestId('wk-canvas', item)).toBe(`wk-canvas-block-${item.id}`);
  });
});
