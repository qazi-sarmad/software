import { describe, expect, it } from 'vitest';
import {
  CONTENTS_LIMITS, DEFAULT_CONTENTS_STYLE, DEFAULT_FORMAT_LAYOUT, HEADING_LABEL_LIMITS, REPORT_PALETTE,
  TYPOGRAPHY_LIMITS, applyFormat, defaultFormat, formatBodyHash,
  formatCanonicalKey, isValidColour, layoutFromRow, mergeStoredLayout, resolveTypography, resolvedRegisters, toContentsSpec, toPdfTypography,
  validateFormat, validateHeadingLabel,
  type FormatLayout, type FormatModelScope, type ReportFormat,
} from './reportFormat';

const PLAN = [
  { key: 'cover', role: 'lead_in' as const, label: 'Cover' },
  { key: 'scope', role: 'scope' as const, label: 'Scope' },
  { key: 'findings', role: 'findings' as const, label: 'Findings' },
  { key: 'coverage', role: 'coverage' as const, label: 'Coverage' },
];

const SCOPE: FormatModelScope = {
  modelId: 'M1',
  sectionIds: PLAN.map((p) => p.key),
  defaultLocale: 'en-GB',
  allowedRegisters: [
    { formality: 3, tone: 2, voice: 'active' },
    { formality: 5, tone: 4, voice: 'passive' },
  ],
};

function makeFormat(over: Partial<ReportFormat> = {}): ReportFormat {
  const base = defaultFormat('org-a', 'board-quarterly', 'M1', PLAN, 'en-GB', DEFAULT_FORMAT_LAYOUT);
  return { ...base, id: 'f1', createdAt: '2026-10-26T09:00:00Z', createdBy: 'u1', bodyHash: '', ...over };
}

describe('reportFormat: the default format is every section visible in plan order', () => {
  it('produces one block per plan section, visible, at the model default', () => {
    const f = makeFormat();
    expect(f.blocks.map((b) => b.key)).toEqual(['cover', 'scope', 'findings', 'coverage']);
    expect(f.blocks.every((b) => b.visible && b.register === null)).toBe(true);
    expect(validateFormat(f, SCOPE)).toEqual([]);
  });

  it('applies to the plan with no hidden and no untouched blocks', () => {
    const applied = applyFormat(makeFormat(), PLAN, { formality: 3, tone: 2, voice: 'active' });
    expect(applied.blocks.map((b) => b.key)).toEqual(['cover', 'scope', 'findings', 'coverage']);
    expect(applied.hidden).toEqual([]);
    expect(applied.untouched).toEqual([]);
    expect(applied.blocks.every((b) => b.register.formality === 3)).toBe(true);
  });
});

describe('reportFormat: reordering and hiding change presentation only', () => {
  it('honours the format order for named blocks', () => {
    const f = makeFormat();
    f.blocks = [f.blocks[2], f.blocks[0], f.blocks[1], f.blocks[3]]; // findings first
    const applied = applyFormat(f, PLAN, { formality: 3, tone: 2, voice: 'active' });
    expect(applied.blocks.map((b) => b.key)).toEqual(['findings', 'cover', 'scope', 'coverage']);
  });

  it('reports hidden blocks rather than dropping them silently', () => {
    const f = makeFormat();
    f.blocks = f.blocks.map((b) => (b.key === 'coverage' ? { ...b, visible: false } : b));
    const applied = applyFormat(f, PLAN, { formality: 3, tone: 2, voice: 'active' });
    expect(applied.hidden).toEqual(['coverage']);
    expect(applied.blocks.map((b) => b.key)).toEqual(['cover', 'scope', 'findings']);
  });

  it('keeps a plan section the format never mentions, at the model default', () => {
    const f = makeFormat();
    f.blocks = f.blocks.filter((b) => b.key !== 'scope');
    const applied = applyFormat(f, PLAN, { formality: 5, tone: 4, voice: 'passive' });
    expect(applied.untouched).toEqual(['scope']);
    const scope = applied.blocks.find((b) => b.key === 'scope')!;
    expect(scope.register).toEqual({ formality: 5, tone: 4, voice: 'passive' });
  });

  it('resolves a per-block register from the registers the model allows', () => {
    const f = makeFormat();
    f.blocks = f.blocks.map((b) => (b.key === 'findings' ? { ...b, register: { formality: 5, tone: 4, voice: 'passive' as const } } : b));
    expect(validateFormat(f, SCOPE)).toEqual([]);
    const applied = applyFormat(f, PLAN, { formality: 3, tone: 2, voice: 'active' });
    expect(resolvedRegisters(applied).findings).toEqual({ formality: 5, tone: 4, voice: 'passive' });
    expect(resolvedRegisters(applied).cover).toEqual({ formality: 3, tone: 2, voice: 'active' });
  });
});

describe('reportFormat: validation names every way a format could smuggle a fact in', () => {
  it('refuses a section the model does not define', () => {
    const f = makeFormat();
    f.blocks = [...f.blocks, { key: 'invented', label: 'Extra', role: 'findings' as const, visible: true, register: null }];
    const issues = validateFormat(f, SCOPE);
    expect(issues.map((i) => i.code)).toContain('unknown_section');
  });

  it('refuses a register the model does not allow', () => {
    const f = makeFormat();
    f.blocks = f.blocks.map((b) => (b.key === 'findings' ? { ...b, register: { formality: 1, tone: 1, voice: 'active' as const } } : b));
    const issues = validateFormat(f, SCOPE);
    expect(issues.map((i) => i.code)).toContain('register_not_allowed');
  });

  it('refuses a duplicate section', () => {
    const f = makeFormat();
    f.blocks = [...f.blocks, { ...f.blocks[0] }];
    expect(validateFormat(f, SCOPE).map((i) => i.code)).toContain('duplicate_section');
  });

  it('refuses margins that leave no room for content', () => {
    const f = makeFormat();
    f.layout = { ...DEFAULT_FORMAT_LAYOUT, marginLeftMm: 120, marginRightMm: 120 };
    expect(validateFormat(f, SCOPE).map((i) => i.code)).toContain('margins_too_wide');
  });

  it('refuses a locale outside the two supported', () => {
    const f = makeFormat();
    f.defaultLocale = 'fr-FR' as never;
    expect(validateFormat(f, SCOPE).map((i) => i.code)).toContain('bad_locale');
  });

  it('refuses an audience that may edit but not view', () => {
    const f = makeFormat();
    f.audiences = [{ roleSlug: 'cia', canView: false, canEdit: true }];
    expect(validateFormat(f, SCOPE).map((i) => i.code)).toContain('audience_contradiction');
  });

  it('refuses a model mismatch', () => {
    const f = makeFormat({ modelId: 'M2' });
    expect(validateFormat(f, SCOPE).map((i) => i.code)).toContain('model_mismatch');
  });
});

describe('reportFormat: the body hash moves only when the format genuinely changes', () => {
  const body = (f: ReportFormat) => {
    const { bodyHash: _h, id: _i, createdAt: _c, createdBy: _b, ...rest } = f;
    return rest;
  };

  it('is stable for the same format', async () => {
    const a = await formatBodyHash(body(makeFormat()));
    const b = await formatBodyHash(body(makeFormat()));
    expect(a).toBe(b);
  });

  it('changes when a block is hidden, reordered or re-registered', async () => {
    const base = await formatBodyHash(body(makeFormat()));
    const hidden = makeFormat();
    hidden.blocks = hidden.blocks.map((b) => (b.key === 'scope' ? { ...b, visible: false } : b));
    expect(await formatBodyHash(body(hidden))).not.toBe(base);

    const reordered = makeFormat();
    reordered.blocks = [...reordered.blocks].reverse();
    expect(await formatBodyHash(body(reordered))).not.toBe(base);

    const rereg = makeFormat();
    rereg.blocks = rereg.blocks.map((b) => (b.key === 'findings' ? { ...b, register: { formality: 5, tone: 4, voice: 'passive' as const } } : b));
    expect(await formatBodyHash(body(rereg))).not.toBe(base);
  });

  it('changes when the layout changes', async () => {
    const base = await formatBodyHash(body(makeFormat()));
    const wider = makeFormat();
    wider.layout = { ...DEFAULT_FORMAT_LAYOUT, marginLeftMm: 30 };
    expect(await formatBodyHash(body(wider))).not.toBe(base);
  });

  it('does not change when only the audience order changes (audiences are sorted)', async () => {
    const a = makeFormat();
    a.audiences = [{ roleSlug: 'cia', canView: true, canEdit: true }, { roleSlug: 'audit_manager', canView: true, canEdit: false }];
    const b = makeFormat();
    b.audiences = [...a.audiences].reverse();
    expect(await formatBodyHash(body(a))).toBe(await formatBodyHash(body(b)));
  });

  it('gives a canonical key that is the sorted-key serialisation', () => {
    const key = formatCanonicalKey(makeFormat());
    // Sorted keys: "audiences" precedes "blocks" precedes "defaultLocale" precedes "formatKey".
    expect(key.indexOf('"audiences"')).toBeLessThan(key.indexOf('"blocks"'));
    expect(key.indexOf('"blocks"')).toBeLessThan(key.indexOf('"defaultLocale"'));
    expect(key.indexOf('"defaultLocale"')).toBeLessThan(key.indexOf('"formatKey"'));
  });
});

describe('reportFormat: layout defaults use design tokens, never a hex literal', () => {
  it('names tokens for every colour', () => {
    const l: FormatLayout = DEFAULT_FORMAT_LAYOUT;
    for (const v of [l.colourPrimary, l.colourAccent, l.colourText, l.colourBackground]) {
      expect(v.startsWith('brand-')).toBe(true);
      expect(/#/.test(v)).toBe(false);
    }
  });
});

describe('reportFormat: typography and colour model (WP-C1)', () => {
  it('defaults to self-hosted fonts and in-range typography', () => {
    const l = DEFAULT_FORMAT_LAYOUT;
    expect(l.fontHeading).toBe('Source Serif 4');
    expect(l.fontBody).toBe('Inter');
    expect(validateFormat(makeFormat(), SCOPE)).toEqual([]);
  });

  it('rejects an out-of-range body size, line height and heading scale', () => {
    const tooSmall = makeFormat(); tooSmall.layout = { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 4 };
    expect(validateFormat(tooSmall, SCOPE).some((i) => i.code === 'font_size_out_of_range')).toBe(true);
    const tooBig = makeFormat(); tooBig.layout = { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 40 };
    expect(validateFormat(tooBig, SCOPE).some((i) => i.code === 'font_size_out_of_range')).toBe(true);
    const tight = makeFormat(); tight.layout = { ...DEFAULT_FORMAT_LAYOUT, lineHeightPct: 50 };
    expect(validateFormat(tight, SCOPE).some((i) => i.code === 'line_height_out_of_range')).toBe(true);
    const flat = makeFormat(); flat.layout = { ...DEFAULT_FORMAT_LAYOUT, headingScalePct: 50 };
    expect(validateFormat(flat, SCOPE).some((i) => i.code === 'heading_scale_out_of_range')).toBe(true);
  });

  it('rejects a weight the font cannot take and a font outside the catalogue', () => {
    const badWeight = makeFormat(); badWeight.layout = { ...DEFAULT_FORMAT_LAYOUT, fontWeightBody: 350 };
    expect(validateFormat(badWeight, SCOPE).some((i) => i.code === 'font_weight_not_available')).toBe(true);
    const badFont = makeFormat(); badFont.layout = { ...DEFAULT_FORMAT_LAYOUT, fontHeading: 'Comic Sans MS' };
    expect(validateFormat(badFont, SCOPE).some((i) => i.code === 'font_not_available')).toBe(true);
  });

  it('rejects a colour that is neither a token nor a hex value', () => {
    const bad = makeFormat(); bad.layout = { ...DEFAULT_FORMAT_LAYOUT, colourPrimary: 'not-a-colour' };
    expect(validateFormat(bad, SCOPE).some((i) => i.code === 'bad_colour')).toBe(true);
    expect(isValidColour('brand-primary')).toBe(true);
    expect(isValidColour('#2F6F5E')).toBe(true);
    expect(isValidColour('#abc')).toBe(true);
    expect(isValidColour('rgb(1,2,3)')).toBe(false);
    expect(isValidColour('')).toBe(false);
  });

  it('every curated palette entry is a valid colour', () => {
    expect(REPORT_PALETTE.length).toBeGreaterThan(5);
    for (const p of REPORT_PALETTE) expect(isValidColour(p.value)).toBe(true);
  });

  it('resolves typography: heading is body × headingScale, weights snap to the family', () => {
    const t = resolveTypography(DEFAULT_FORMAT_LAYOUT);
    expect(t.bodyPt).toBe(11);
    expect(t.headingPt).toBeCloseTo(17.6, 1);
    expect(t.bodyWeight).toBe(400);
    expect(t.headingWeight).toBe(600);
    // A weight the family does not ship snaps to the nearest it does.
    const snap = resolveTypography({ ...DEFAULT_FORMAT_LAYOUT, fontBody: 'Libre Baskerville', fontWeightBody: 700 });
    expect(snap.bodyWeight).toBe(400);
  });

  it('clamps out-of-range values rather than producing an unreadable page', () => {
    const t = resolveTypography({ ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 99, headingScalePct: 900, lineHeightPct: 900 });
    expect(t.bodyPt).toBe(TYPOGRAPHY_LIMITS.fontSizePt.max);
    expect(t.lineHeight).toBe(TYPOGRAPHY_LIMITS.lineHeightPct.max / 100);
    expect(t.headingPt).toBeLessThanOrEqual(TYPOGRAPHY_LIMITS.fontSizePt.max * (TYPOGRAPHY_LIMITS.headingScalePct.max / 100));
  });

  it('a typography change moves the format body hash (it is a real, versioned change)', async () => {
    const a = makeFormat();
    const b = makeFormat(); b.layout = { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 12 };
    const body = (f: ReportFormat) => ({ ...f, audiences: f.audiences });
    expect(await formatBodyHash(body(a))).not.toBe(await formatBodyHash(body(b)));
  });
});

describe('reportFormat: the printed typography the renderer consumes (WP-C3)', () => {
  it('adapts a layout to the PDF typography shape the canvas agrees with', () => {
    const layout: FormatLayout = { ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 12, headingScalePct: 150, lineHeightPct: 180 };
    const typo = toPdfTypography(layout);
    const resolved = resolveTypography(layout);
    expect(typo.bodyPt).toBe(resolved.bodyPt);
    expect(typo.headingPt).toBe(resolved.headingPt);
    expect(typo.lineHeight).toBeCloseTo(1.8, 5);
    expect(typo.bodyWeight).toBe(resolved.bodyWeight);
    expect(typo.headingWeight).toBe(resolved.headingWeight);
  });

  it('clamps an out-of-range layout, so the printed page never leaves the readable band', () => {
    const typo = toPdfTypography({ ...DEFAULT_FORMAT_LAYOUT, fontSizePt: 99, lineHeightPct: 5 });
    expect(typo.bodyPt).toBe(TYPOGRAPHY_LIMITS.fontSizePt.max);
    expect(typo.lineHeight).toBeCloseTo(TYPOGRAPHY_LIMITS.lineHeightPct.min / 100, 5);
  });

  it('merges a stored layout row onto the defaults, ignoring unknown and invalid keys', () => {
    const layout = layoutFromRow({ fontSizePt: 13, pageSize: 'Letter', bogus: 'x', colourPrimary: '' });
    expect(layout.fontSizePt).toBe(13);
    expect(layout.pageSize).toBe('Letter');
    expect(layout.colourPrimary).toBe(DEFAULT_FORMAT_LAYOUT.colourPrimary);
    expect((layout as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('returns the defaults when no row is stored', () => {
    expect(layoutFromRow(null)).toEqual(DEFAULT_FORMAT_LAYOUT);
    expect(layoutFromRow(undefined)).toEqual(DEFAULT_FORMAT_LAYOUT);
  });

  it('snaps a stored weight to one the chosen family actually ships', () => {
    const layout = layoutFromRow({ fontBody: 'Inter', fontWeightBody: 550 });
    expect([400, 500, 600, 700]).toContain(layout.fontWeightBody);
  });
});

describe('WP-H: a client may set a block heading, under one plain-text rule', () => {
  it('accepts a short, single-line, plain label', () => {
    expect(validateHeadingLabel('Observations and actions')).toEqual({ ok: true });
  });

  it.each([
    ['', 'a heading needs a label'],
    ['   ', 'a heading needs a label'],
    ['<b>Findings</b>', 'a heading must be plain text, without markup'],
    ['two\nlines', 'a heading must be a single line'],
    ['x'.repeat(HEADING_LABEL_LIMITS.maxLength + 1), `a heading may be at most ${HEADING_LABEL_LIMITS.maxLength} characters`],
  ])('rejects %j with a reason', (label, reason) => {
    const r = validateHeadingLabel(label);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
  });

  it('reports a bad heading label from validateFormat', () => {
    const f = makeFormat();
    f.blocks = f.blocks.map((b) => (b.key === 'findings' ? { ...b, label: '<b>Findings</b>' } : b));
    const issues = validateFormat(f, SCOPE);
    expect(issues.some((i) => i.code === 'bad_heading_label')).toBe(true);
  });

  it('keeps the heading label out of the fact ledger: it changes the body hash, never a claim', async () => {
    const a = makeFormat();
    const b = makeFormat();
    b.blocks = b.blocks.map((x) => (x.key === 'findings' ? { ...x, label: 'Observations' } : x));
    expect(await formatBodyHash(a)).not.toBe(await formatBodyHash(b));
  });
});

describe('WP-T: the contents design is validated and hashed', () => {
  it('defaults to an enabled, numbered, depth-2 contents page', () => {
    expect(DEFAULT_FORMAT_LAYOUT.contents).toEqual(DEFAULT_CONTENTS_STYLE);
    expect(DEFAULT_CONTENTS_STYLE.enabled).toBe(true);
    expect(DEFAULT_CONTENTS_STYLE.depth).toBe(2);
  });

  it('rejects a contents title that is empty or carries markup', () => {
    const f = makeFormat();
    f.layout = { ...f.layout, contents: { ...f.layout.contents, title: '<i>Index</i>' } };
    expect(validateFormat(f, SCOPE).some((i) => i.code === 'bad_contents_title')).toBe(true);
  });

  it('rejects a contents title size outside its bounds', () => {
    const f = makeFormat();
    f.layout = { ...f.layout, contents: { ...f.layout.contents, titleScalePct: CONTENTS_LIMITS.titleScalePct.max + 1 } };
    expect(validateFormat(f, SCOPE).some((i) => i.code === 'contents_title_out_of_range')).toBe(true);
  });

  it('merges a stored contents design onto the defaults', () => {
    const layout = layoutFromRow({ contents: { enabled: true, depth: 1, title: 'Index', titleScalePct: 999 } });
    expect(layout.contents.depth).toBe(1);
    expect(layout.contents.title).toBe('Index');
    expect(layout.contents.titleScalePct).toBe(CONTENTS_LIMITS.titleScalePct.max);
  });

  it('maps an enabled contents design to the renderer spec, and a disabled one to nothing', () => {
    expect(toContentsSpec(DEFAULT_FORMAT_LAYOUT)?.depth).toBe(2);
    const off: FormatLayout = { ...DEFAULT_FORMAT_LAYOUT, contents: { ...DEFAULT_CONTENTS_STYLE, enabled: false } };
    expect(toContentsSpec(off)).toBeUndefined();
  });

  it('puts the contents design in the format body hash', async () => {
    const a = makeFormat();
    const b = makeFormat();
    b.layout = { ...b.layout, contents: { ...b.layout.contents, depth: 1 } };
    expect(await formatBodyHash(a)).not.toBe(await formatBodyHash(b));
  });
});

describe('WP-C4: the typography adapter carries the families to the renderers', () => {
  it('includes the heading and body families', () => {
    const t = toPdfTypography({ ...DEFAULT_FORMAT_LAYOUT, fontHeading: 'Georgia', fontBody: 'Inter' });
    expect(t.headingFamily).toBe('Georgia');
    expect(t.bodyFamily).toBe('Inter');
  });
});

describe('mergeStoredLayout — a stored layout must not drop a nested template field', () => {
  it('fills a partial chrome from the defaults rather than leaving a template undefined', () => {
    const merged = mergeStoredLayout({ chrome: { headerEnabled: true } } as never);
    expect(merged.chrome.headerEnabled).toBe(true);
    expect(merged.chrome.headerLeft).toBe(DEFAULT_FORMAT_LAYOUT.chrome.headerLeft);
    expect(merged.chrome.footerRight).toBe(DEFAULT_FORMAT_LAYOUT.chrome.footerRight);
    expect(merged.chrome.pageNumber).toBe(DEFAULT_FORMAT_LAYOUT.chrome.pageNumber);
  });

  it('fills partial grid and contents, and keeps an explicit scalar override', () => {
    const merged = mergeStoredLayout({ fontSizePt: 13, grid: { sizeMm: 8 } } as never);
    expect(merged.fontSizePt).toBe(13);
    expect(merged.grid.sizeMm).toBe(8);
    expect(merged.grid.subdivisions).toBe(DEFAULT_FORMAT_LAYOUT.grid.subdivisions);
    expect(merged.contents).toEqual(DEFAULT_FORMAT_LAYOUT.contents);
  });

  it('is total: null and undefined yield the defaults', () => {
    expect(mergeStoredLayout(null)).toEqual(DEFAULT_FORMAT_LAYOUT);
    expect(mergeStoredLayout(undefined)).toEqual(DEFAULT_FORMAT_LAYOUT);
  });
});
