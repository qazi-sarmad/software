import { describe, expect, it } from 'vitest';
import {
  buildBoardPackPdf,
  buildBoardPackPptx,
  capAgingRows,
  figureRowsByGroup,
  ganttFigureBlock,
  ganttTable,
  heatmapFigureBlock,
  heatmapTable,
} from './boardPackDocuments';
import { DEFAULT_BRANDING, type BrandingSpec } from './render/branding';
import type { BoardPackSnapshot } from './boardPack';

const branding: BrandingSpec = { orgId: 'org-1', ...DEFAULT_BRANDING };
const ref = (type: string, id: string) => ({ type, id });

const snapshot: BoardPackSnapshot = {
  sira: { bands: [{ value: 2, refs: [ref('sira_score', 's1')], band: 'High' }] },
  plan: {
    value: 3, refs: [ref('plan_item', 'p1')],
    by_status: [{ value: 2, refs: [ref('plan_item', 'p1')], status: 'approved' }],
  },
  cap: { '0-30': { value: 1, refs: [ref('cap', 'c1')] }, '90+': { value: 0, refs: [] } },
  sealed_work: { value: 4, refs: [ref('workpaper', 'w1')] },
  management_responses: { value: 1, refs: [ref('report_block', 'b1')] },
  excluded: { unsealed_workpapers: 2, unsealed_engagements: 0 },
};

/** A snapshot with the depth migration 0099 adds: the heatmap grid and the Gantt rows. */
const deepSnapshot: BoardPackSnapshot = {
  ...snapshot,
  sira: {
    bands: [{ value: 3, refs: [ref('sira_score', 's1')], band: 'High' }],
    heatmap: {
      entities: ['Payroll', 'Treasury'],
      bands: ['Low', 'High'],
      cells: [
        { entity: 'Payroll', band: 'High', value: 2, refs: [ref('sira_score', 's1'), ref('sira_score', 's2')] },
        { entity: 'Treasury', band: 'Low', value: 1, refs: [ref('sira_score', 's3')] },
      ],
    },
  },
  plan: {
    ...snapshot.plan!,
    gantt: [
      { value: 1, refs: [ref('plan_item', 'p1')], title: 'Payroll audit', start: '2026-03-01', end: '2026-03-11', status: 'approved' },
      { value: 1, refs: [ref('plan_item', 'p2')], title: 'Treasury review', start: '2026-03-05', end: '2026-03-06', status: 'proposed' },
    ],
  },
};

const input = {
  title: 'Acme FY26 pack',
  snapshot,
  branding,
  appBaseUrl: 'https://provio.example',
  dataHash: 'a'.repeat(64),
  generatedAt: '2026-10-19T10:00:00.000Z',
};

const deepInput = { ...input, snapshot: deepSnapshot };

describe('figureRowsByGroup', () => {
  it('groups figures in the F10 section order', () => {
    const groups = figureRowsByGroup(snapshot);
    expect(groups.map((g) => g.group)).toEqual([
      'SIRA residual risk', 'Audit plan progress', 'Open issues and CAP aging',
      'Sealed work and integrity', 'Management responses',
    ]);
  });

  it('keeps a zero figure in its group', () => {
    const cap = figureRowsByGroup(snapshot).find((g) => g.group === 'Open issues and CAP aging');
    expect(cap?.rows.map((r) => r.path)).toEqual(['cap.0-30', 'cap.90+']);
  });
});

describe('buildBoardPackPdf', () => {
  it('opens with the cover and assurance statement', () => {
    const model = buildBoardPackPdf(input);
    expect(model.title).toBe('Acme FY26 pack');
    expect(model.sections[0].heading).toBe('Cover and assurance statement');
    expect(model.sections[0].blocks.map((b) => ('text' in b ? b.text : '')).join(' ')).toContain(input.dataHash);
  });

  it('turns every figure that has a ref into a hyperlink to its record', () => {
    const model = buildBoardPackPdf(input);
    const links = model.sections.flatMap((s) => s.links ?? []);
    expect(links.map((l) => l.url)).toContain('https://provio.example/view/sira_score/s1');
    expect(links.map((l) => l.url)).toContain('https://provio.example/view/cap/c1');
    expect(links.map((l) => l.url)).toContain('https://provio.example/view/workpaper/w1');
  });

  it('emits no link for a figure with no refs', () => {
    const model = buildBoardPackPdf(input);
    const links = model.sections.flatMap((s) => s.links ?? []);
    expect(links.some((l) => l.url.includes('/cap/'))).toBe(true);
    // The zero 90+ band has no ref, so no link carries a value of 0 for it.
    expect(links.some((l) => l.label.startsWith('CAP aging: More than 90 days overdue'))).toBe(false);
  });

  it('closes with the sources index that states what is excluded', () => {
    const model = buildBoardPackPdf(input);
    const last = model.sections[model.sections.length - 1];
    expect(last.heading).toBe('Sources');
    expect(last.blocks.map((b) => ('text' in b ? b.text : '')).join(' ')).toContain('2 workpapers not yet sealed are not included.');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildBoardPackPdf(input))).toBe(JSON.stringify(buildBoardPackPdf(input)));
  });
});

describe('buildBoardPackPptx', () => {
  it('has a cover slide, a slide per group and a sources slide', () => {
    const model = buildBoardPackPptx(input);
    expect(model.slides[0].title).toBe('Acme FY26 pack');
    expect(model.slides[0].bullets).toContain(`Snapshot hash ${input.dataHash}`);
    expect(model.slides[model.slides.length - 1].title).toBe('Sources');
    expect(model.slides.length).toBe(7);
  });

  it('carries a native table and hyperlinks on a figure slide', () => {
    const model = buildBoardPackPptx(input);
    const capSlide = model.slides.find((s) => s.title === 'Open issues and CAP aging');
    expect(capSlide?.table?.header).toEqual(['Figure', 'Value']);
    expect(capSlide?.table?.rows).toContainEqual(['CAP aging: 0 to 30 days overdue', '1']);
    expect(capSlide?.links?.map((l) => l.url)).toContain('https://provio.example/view/cap/c1');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildBoardPackPptx(input))).toBe(JSON.stringify(buildBoardPackPptx(input)));
  });
});

describe('capAgingRows', () => {
  it('returns the bands in the F10 order with plain labels', () => {
    const rows = capAgingRows(snapshot);
    expect(rows.map((r) => r.band)).toEqual(['0-30', '90+']);
    expect(rows[0].label).toBe('0 to 30 days overdue');
    expect(rows[0].value).toBe(1);
  });

  it('is empty when the snapshot has no CAP figures', () => {
    expect(capAgingRows({})).toEqual([]);
  });
});

describe('heatmapTable', () => {
  it('builds a dense entity × band table', () => {
    const table = heatmapTable(deepSnapshot);
    expect(table?.header).toEqual(['Entity', 'Low', 'High']);
    expect(table?.rows).toEqual([['Payroll', '0', '2'], ['Treasury', '1', '0']]);
  });

  it('is null for a pack with no heatmap, so an old pack still renders', () => {
    expect(heatmapTable(snapshot)).toBeNull();
    expect(heatmapTable({})).toBeNull();
  });
});

describe('ganttTable', () => {
  it('lists each dated plan item with its window and status', () => {
    const table = ganttTable(deepSnapshot, '2026-03-10');
    expect(table?.header).toEqual(['Plan item', 'Start', 'End', 'Days', 'Status']);
    expect(table?.rows[0]).toEqual(['Payroll audit', '2026-03-01', '2026-03-11', '10', 'approved']);
  });

  it('is null when no plan item carries a date', () => {
    expect(ganttTable(snapshot, '2026-03-10')).toBeNull();
  });
});

describe('heatmapFigureBlock', () => {
  it('produces a real PNG figure for the heatmap', () => {
    const block = heatmapFigureBlock(deepInput);
    expect(block).not.toBeNull();
    expect(block!.kind).toBe('figure');
    // A PNG signature, so the block is genuinely an image the PDF can embed.
    expect(Array.from(block!.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(block!.caption).toContain('3 scores across 2 entities');
  });

  it('is null when there is no heatmap, so no empty chart is drawn', () => {
    expect(heatmapFigureBlock(input)).toBeNull();
  });

  it('is byte-identical for the same input (deterministic)', () => {
    expect(Array.from(heatmapFigureBlock(deepInput)!.png)).toEqual(Array.from(heatmapFigureBlock(deepInput)!.png));
  });
});

describe('ganttFigureBlock', () => {
  it('produces a real PNG figure for the plan window', () => {
    const block = ganttFigureBlock(deepInput);
    expect(block).not.toBeNull();
    expect(Array.from(block!.png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(block!.caption).toContain('2 planned items, 2026-03-01 to 2026-03-11');
  });

  it('is null when the plan has no dates', () => {
    expect(ganttFigureBlock(input)).toBeNull();
  });
});

describe('the deep pack in the PDF and the PPTX', () => {
  it('adds the heatmap and Gantt sections with their tables to the PDF', () => {
    const model = buildBoardPackPdf(deepInput);
    const headings = model.sections.map((s) => s.heading);
    expect(headings).toContain('SIRA residual risk heatmap');
    expect(headings).toContain('Audit plan window');
    const heat = model.sections.find((s) => s.heading === 'SIRA residual risk heatmap');
    expect(heat?.table?.rows).toContainEqual(['Payroll', '0', '2']);
    const gantt = model.sections.find((s) => s.heading === 'Audit plan window');
    expect(gantt?.table?.rows[0][0]).toBe('Payroll audit');
    // The figure blocks are embedded PNGs the renderer draws.
    expect(heat?.blocks.some((b) => b.kind === 'figure')).toBe(true);
  });

  it('adds a heatmap slide and a Gantt slide with native charts to the PPTX', () => {
    const model = buildBoardPackPptx(deepInput);
    const heat = model.slides.find((s) => s.title === 'SIRA residual risk heatmap');
    expect(heat?.table?.rows).toContainEqual(['Payroll', '0', '2']);
    expect(heat?.chart?.values).toEqual([2, 1]);
    const gantt = model.slides.find((s) => s.title === 'Audit plan window');
    expect(gantt?.chart?.values).toEqual([10, 1]);
  });

  it('leaves an old pack (no heatmap, no Gantt) rendering exactly as before', () => {
    expect(buildBoardPackPdf(input).sections.map((s) => s.heading)).not.toContain('SIRA residual risk heatmap');
    expect(buildBoardPackPptx(input).slides.length).toBe(7);
  });

  it('is deterministic for the deep pack', () => {
    expect(JSON.stringify(buildBoardPackPdf(deepInput))).toBe(JSON.stringify(buildBoardPackPdf(deepInput)));
  });
});
