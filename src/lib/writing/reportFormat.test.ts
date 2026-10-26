import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT_LAYOUT, applyFormat, defaultFormat, formatBodyHash, formatCanonicalKey,
  resolvedRegisters, validateFormat, type FormatLayout, type FormatModelScope, type ReportFormat,
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
