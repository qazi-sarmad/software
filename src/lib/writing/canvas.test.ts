import { describe, expect, it } from 'vitest';
import { buildCanvas, blockHeightPx, mmToPx } from './canvas';
import { DEFAULT_FORMAT_LAYOUT, defaultFormat, type ReportFormat } from './reportFormat';
import type { RegisterChoice } from './reportFormat';

const PLAN = [
  { key: 'cover', role: 'lead_in' as const, label: 'Cover' },
  { key: 'scope', role: 'scope' as const, label: 'Scope' },
  { key: 'findings', role: 'findings' as const, label: 'Findings' },
  { key: 'coverage', role: 'coverage' as const, label: 'Coverage' },
];

const DEFAULT_REGISTER: RegisterChoice = { formality: 3, tone: 2, voice: 'active' };

function makeFormat(over: Partial<ReportFormat> = {}): ReportFormat {
  const base = defaultFormat('org-a', 'board-quarterly', 'M1', PLAN, 'en-GB', DEFAULT_FORMAT_LAYOUT);
  return { ...base, id: 'f1', createdAt: '2026-10-26T09:00:00Z', createdBy: 'u1', bodyHash: '', ...over };
}

describe('WP-C2 the live canvas page model', () => {
  it('sizes an A4 page and its content box from the layout, in pixels', () => {
    const page = buildCanvas({ format: makeFormat(), plan: PLAN, modelDefault: DEFAULT_REGISTER });
    expect(page.pageSize).toBe('A4');
    // A4 is 210 × 297 mm.
    expect(page.widthPx).toBe(mmToPx(210));
    expect(page.heightPx).toBe(mmToPx(297));
    // 20 mm margins on all sides.
    expect(page.marginLeftPx).toBe(mmToPx(20));
    expect(page.contentWidthPx).toBe(page.widthPx - 2 * mmToPx(20));
    expect(page.contentHeightPx).toBe(page.heightPx - 2 * mmToPx(20));
  });

  it('letter page size is wider and shorter than A4', () => {
    const fmt = makeFormat();
    fmt.layout = { ...DEFAULT_FORMAT_LAYOUT, pageSize: 'Letter' };
    const page = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER });
    expect(page.pageSize).toBe('Letter');
    expect(page.widthPx).toBe(mmToPx(215.9));
  });

  it('places one block per visible section, in format order', () => {
    const page = buildCanvas({ format: makeFormat(), plan: PLAN, modelDefault: DEFAULT_REGISTER });
    expect(page.blocks.map((b) => b.key)).toEqual(PLAN.map((p) => p.key));
    // Each block carries the resolved typography, so the canvas and the PDF agree.
    expect(page.blocks[0].bodyPt).toBe(11);
    expect(page.blocks[0].headingPt).toBeCloseTo(17.6, 1);
    expect(page.blocks[0].bodyWeight).toBe(400);
  });

  it('a hidden block is absent from the canvas, not drawn as an empty one', () => {
    const fmt = makeFormat();
    fmt.blocks = fmt.blocks.map((b) => (b.key === 'coverage' ? { ...b, visible: false } : b));
    const page = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER });
    expect(page.blocks.some((b) => b.key === 'coverage')).toBe(false);
  });

  it('the same format and body lines always produce the same page (deterministic)', () => {
    const fmt = makeFormat();
    const lines = { findings: 12, scope: 3 };
    const a = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: lines });
    const b = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: lines });
    expect(a).toEqual(b);
  });

  it('a larger body size and looser line height make the page taller', () => {
    const small = buildCanvas({ format: makeFormat(), plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: { findings: 10 } });
    const big = makeFormat();
    big.layout = { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 15, lineHeightPct: 220 };
    const large = buildCanvas({ format: big, plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: { findings: 10 } });
    const smallFinding = small.blocks.find((b) => b.key === 'findings')!;
    const largeFinding = large.blocks.find((b) => b.key === 'findings')!;
    expect(largeFinding.heightPx).toBeGreaterThan(smallFinding.heightPx);
  });

  it('reports overflow when the blocks exceed the first page', () => {
    const fmt = makeFormat();
    const many = { cover: 5, scope: 40, findings: 60, coverage: 40 };
    const page = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: many });
    expect(page.overflowsFirstPage).toBe(true);
    const short = buildCanvas({ format: fmt, plan: PLAN, modelDefault: DEFAULT_REGISTER, bodyLines: { cover: 1 } });
    expect(short.overflowsFirstPage).toBe(false);
  });

  it('blockHeightPx is heading plus body lines, with a whole-number result', () => {
    expect(blockHeightPx(17.6, 11, 1.4, 0)).toBe(Math.round(17.6 * 1.2 + 0 + 16));
    expect(blockHeightPx(17.6, 11, 1.4, 10)).toBe(Math.round(17.6 * 1.2 + 11 * 1.4 * 10 + 16));
    expect(Number.isInteger(blockHeightPx(17.6, 11, 1.4, 10))).toBe(true);
  });
});
