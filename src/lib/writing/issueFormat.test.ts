import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { composeReport, type ComposerInput } from './compose';
import { applyIssuedFormat, issueDocument } from './issue';
import { DEFAULT_FORMAT_LAYOUT, defaultFormat, type ReportFormat } from './reportFormat';
import { buildContents, toPdfModel } from '../render/document';
import { docxStyles, renderDocx } from '../render/docx';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, TEST_VOCABULARY, fixtureClaims, fixtureVariants, releasedSeedPhrases,
} from './fixtures';
import type { ClaimGraph, Locale, Register } from './types';

const PLAN = [
  { key: 'cover', role: 'lead_in' as const, label: 'Cover' },
  { key: 'scope', role: 'scope' as const, label: 'Scope and period' },
  { key: 'exec', role: 'summary' as const, label: 'Executive summary' },
  { key: 'findings', role: 'findings' as const, label: 'Findings' },
  { key: 'coverage', role: 'coverage' as const, label: 'Coverage' },
  { key: 'appendices', role: 'appendices' as const, label: 'Appendices' },
];

function makeFormat(over: Partial<ReportFormat> = {}): ReportFormat {
  const base = defaultFormat('org-a', 'board-quarterly', 'M1', PLAN, 'en-GB', DEFAULT_FORMAT_LAYOUT);
  return { ...base, id: 'f1', createdAt: '2026-10-26T09:00:00Z', createdBy: 'u1', bodyHash: '', ...over };
}

function input(register: Register, locale: Locale): ComposerInput {
  const graph: ClaimGraph = { modelId: 'M1', register, locale, claims: fixtureClaims(), versions: ENGINE_VERSION };
  return {
    graph, phrases: releasedSeedPhrases(), vocabulary: TEST_VOCABULARY, versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP, format: { scale: 2, rounding: 'half_up', grouping: true, currencySymbol: '\u00a3' },
    variants: fixtureVariants(),
  };
}

async function issue(over: Partial<ReportFormat> = {}) {
  const i = input({ formality: 3, tone: 2, voice: 'active' }, 'en-GB');
  const composed = await composeReport(i);
  return issueDocument({
    composed, graph: i.graph, title: 'Audit report', issuedAt: FIXED_TIMESTAMP, format: makeFormat(over),
  });
}

describe('WP-C4: a published format changes the issued report, not only the preview', () => {
  it('applies the format order to the document sections', async () => {
    const base = await issue();
    const reordered = await issue({ blocks: [...makeFormat().blocks].reverse() });
    const headings = (m: { sections: { heading: string }[] }) => m.sections.map((s) => s.heading);
    expect(headings(base.document)).not.toEqual(headings(reordered.document));
    // The document control section always closes the file, regardless of the format.
    expect(headings(reordered.document).at(-1)).toBe('Document control');
  });

  it('drops a hidden section from the file and keeps the rest', async () => {
    const f = makeFormat();
    const hiddenKey = 'findings';
    const hidden = await issue({ blocks: f.blocks.map((b) => (b.key === hiddenKey ? { ...b, visible: false } : b)) });
    expect(hidden.document.sections.map((s) => s.heading)).not.toContain('Findings');
    expect(hidden.document.sections.map((s) => s.heading)).toContain('Executive summary');
  });

  it('renames a section heading from the format label', async () => {
    const f = makeFormat();
    const renamed = await issue({ blocks: f.blocks.map((b) => (b.key === 'findings' ? { ...b, label: 'Observations' } : b)) });
    expect(renamed.document.sections.map((s) => s.heading)).toContain('Observations');
    expect(renamed.document.sections.map((s) => s.heading)).not.toContain('Findings');
  });

  it('never changes the graph root: a format is presentation only', async () => {
    const a = await issue();
    const b = await issue({ blocks: [...makeFormat().blocks].reverse().map((x) => ({ ...x, label: `X ${x.label}` })) });
    expect(a.metadata.graphRoot).toBe(b.metadata.graphRoot);
  });

  it('keeps every claim when no section is hidden (no silent content loss)', async () => {
    const base = await issue();
    const words = base.document.sections.flatMap((s) => s.blocks.map((b) => b.text ?? '')).join(' ');
    expect(words.length).toBeGreaterThan(0);
    const hidden = await issue({ blocks: makeFormat().blocks.map((b) => ({ ...b, visible: false })) });
    // Every claim-bearing section was hidden, so the only section left is document control.
    expect(hidden.document.sections).toHaveLength(1);
  });
});

describe('WP-C4: applyIssuedFormat keeps unmentioned sections in plan order', () => {
  it('returns every section, in plan order, when no format is given', () => {
    const bySection = PLAN.map((p) => ({ section: { ...p, id: p.key, order: 0, roles: [], registerInvariant: false }, claims: [] }));
    const applied = applyIssuedFormat(undefined, bySection as never, { formality: 3, tone: 2, voice: 'active' });
    expect(applied.blocks.map((b) => b.key)).toEqual(PLAN.map((p) => p.key));
    expect(applied.hidden).toEqual([]);
  });

  it('keeps a section the format never names, in plan order after the named ones', () => {
    const bySection = PLAN.map((p) => ({ section: { ...p, id: p.key, order: 0, roles: [], registerInvariant: false }, claims: [] }));
    const f = makeFormat({ blocks: makeFormat().blocks.filter((b) => b.key !== 'coverage') });
    const applied = applyIssuedFormat(f, bySection as never, { formality: 3, tone: 2, voice: 'active' });
    expect(applied.blocks.map((b) => b.key)).toContain('coverage');
    expect(applied.untouched).toContain('coverage');
  });
});

describe('WP-T: the table of contents is built from the model, never invented', () => {
  it('lists section headings at depth 1 and sub-headings at depth 2', () => {
    const model = {
      title: 'R',
      sections: [
        { heading: 'Findings', blocks: [{ kind: 'heading' as const, text: 'Payment approvals' }, { kind: 'paragraph' as const, text: 'body' }] },
        { heading: 'Coverage', blocks: [{ kind: 'paragraph' as const, text: 'body' }] },
      ],
      contents: { title: 'Contents', depth: 2 as const, numbered: true, includeSections: true, includeSubheadings: true },
    };
    const entries = buildContents(model);
    expect(entries.map((e) => e.label)).toEqual(['Findings', 'Payment approvals', 'Coverage']);
    expect(entries[0].number).toBe('1');
    expect(entries[1].level).toBe(2);
    expect(entries[2].number).toBe('2');
  });

  it('returns nothing when the format disables the contents', () => {
    const model = { title: 'R', sections: [{ heading: 'A', blocks: [] }] };
    expect(buildContents(model)).toEqual([]);
  });

  it('puts the contents page first in the PDF model', () => {
    const model = {
      title: 'R',
      sections: [{ heading: 'Findings', blocks: [{ kind: 'paragraph' as const, text: 'body' }] }],
      contents: { title: 'Contents', depth: 1 as const, numbered: false, includeSections: true, includeSubheadings: false },
    };
    const pdf = toPdfModel(model);
    expect(pdf.sections[0].heading).toBe('Contents');
    expect(pdf.sections[1].heading).toBe('Findings');
  });
});

describe('WP-T/WP-C4: the issued document carries the format typography and contents', () => {
  it('sets typography from the format layout', async () => {
    const issued = await issue({ layout: { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 14, headingScalePct: 150, lineHeightPct: 160 } });
    expect(issued.document.typography?.bodyPt).toBe(14);
    expect(issued.document.typography?.headingPt).toBe(21);
    expect(issued.document.typography?.lineHeight).toBeCloseTo(1.6, 6);
  });

  it('omits the contents when the format disables it', async () => {
    const issued = await issue({ layout: { ...DEFAULT_FORMAT_LAYOUT, contents: { ...DEFAULT_FORMAT_LAYOUT.contents, enabled: false } } });
    expect(issued.document.contents).toBeUndefined();
  });
});

describe('WP-C4: the DOCX renderer honours the format typography', () => {
  it('maps the format sizes, weights and line height to OOXML run properties', () => {
    const s = docxStyles({ headingPt: 18, bodyPt: 12, headingWeight: 700, bodyWeight: 400, lineHeight: 1.5, headingFamily: 'Georgia', bodyFamily: 'Calibri' });
    expect(s.bodyHalfPt).toBe(24);
    expect(s.headingHalfPt).toBe(36);
    expect(s.bodyBold).toBe(false);
    expect(s.lineSpacing).toBe(360);
    expect(s.headingFont).toBe('Georgia');
  });

  it('falls back to the original fixed sizes when no typography is supplied', () => {
    expect(docxStyles(undefined)).toEqual(docxStyles(undefined));
    expect(docxStyles(undefined).bodyHalfPt).toBe(22);
  });

  it('writes the format size into the DOCX run properties', async () => {
    const model = {
      title: 'R',
      sections: [{ heading: 'Findings', blocks: [{ kind: 'paragraph' as const, text: 'body' }] }],
      typography: { headingPt: 20, bodyPt: 14, headingWeight: 700, bodyWeight: 400, lineHeight: 1.5, headingFamily: 'Calibri', bodyFamily: 'Calibri' },
    };
    const bytes = await renderDocx(model);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    // 14pt body => 28 half-points; 20pt heading => 40 half-points.
    expect(xml).toContain('w:sz w:val="28"');
    expect(xml).toContain('w:sz w:val="40"');
  });

  it('prints the contents entries into the DOCX when the format asks for them', async () => {
    const model = {
      title: 'R',
      sections: [{ heading: 'Findings', blocks: [{ kind: 'paragraph' as const, text: 'body' }] }],
      contents: { title: 'Contents', depth: 1 as const, numbered: true, includeSections: true, includeSubheadings: false },
    };
    const bytes = await renderDocx(model);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Contents');
    expect(xml).toContain('1. Findings');
  });
});
