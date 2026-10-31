import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FONT_CATALOGUE, alwaysOnFonts, fontByFamily, fontBySlug, fontFamilyNames, isReportFont,
  lazyFonts, licenceSummary,
} from './catalogue';
import { REPORT_FONT_FAMILIES, fontFileStem } from '../render/fonts';

const ROOT = resolve(process.cwd());

describe('the curated self-hosted font repository (F2, F3)', () => {
  it('is curated, not exhaustive, and covers sans, serif and mono', () => {
    expect(FONT_CATALOGUE.length).toBeGreaterThanOrEqual(8);
    expect(FONT_CATALOGUE.length).toBeLessThan(100);
    for (const cat of ['sans', 'serif', 'mono'] as const) {
      expect(FONT_CATALOGUE.some((f) => f.category === cat), `no ${cat} family`).toBe(true);
    }
  });

  it('has unique family names and slugs', () => {
    expect(new Set(fontFamilyNames()).size).toBe(FONT_CATALOGUE.length);
    expect(new Set(FONT_CATALOGUE.map((f) => f.slug)).size).toBe(FONT_CATALOGUE.length);
  });

  it('carries full licence metadata for every bundled family (F7/G10)', () => {
    for (const f of FONT_CATALOGUE) {
      expect(f.licence.id, `${f.family} has no licence id`).toBeTruthy();
      expect(f.licence.name).toBeTruthy();
      expect(f.licence.url).toMatch(/^https?:\/\//);
      expect(f.licence.attribution, `${f.family} has no attribution`).toBeTruthy();
      expect(f.licence.redistributable, `${f.family} is not redistributable but is bundled`).toBe(true);
    }
  });

  it('ships the latin subset only, with the weights the product loads', () => {
    for (const f of FONT_CATALOGUE) {
      expect(f.subsets).toEqual(['latin']);
      expect(f.weights.length).toBeGreaterThan(0);
      expect(f.weights).toContain(400);
      expect(f.weights).toEqual([...f.weights].sort((a, b) => a - b));
    }
  });

  it('has exactly the three chrome families always on', () => {
    expect(alwaysOnFonts().map((f) => f.family)).toEqual(['Inter', 'Source Serif 4', 'JetBrains Mono']);
    expect(lazyFonts().length).toBe(FONT_CATALOGUE.length - 3);
  });

  it('resolves a family by name and by slug, and reports an unknown one as undefined', () => {
    expect(fontByFamily('Inter')?.slug).toBe('inter');
    expect(fontBySlug('jetbrains-mono')?.family).toBe('JetBrains Mono');
    expect(fontByFamily('Comic Sans MS')).toBeUndefined();
    expect(fontBySlug('nope')).toBeUndefined();
  });

  it('summarises the licence in our own words and never implies a permission it lacks', () => {
    const inter = fontByFamily('Inter')!;
    expect(licenceSummary(inter)).toMatch(/may be bundled and redistributed/);
    expect(licenceSummary(inter)).not.toMatch(/SIL Open Font License 1\.1\.\./);
  });

  it('marks every catalogue family report-embeddable when it is redistributable', () => {
    for (const f of FONT_CATALOGUE) {
      expect(isReportFont(f.family)).toBe(f.reportEmbeddable);
    }
  });

  it('every shipped family has a real woff2 file on disk for each bundled weight', () => {
    for (const f of FONT_CATALOGUE) {
      for (const w of f.weights) {
        const file = resolve(ROOT, `node_modules/@fontsource/${f.slug}/files/${f.slug}-latin-${w}-normal.woff2`);
        expect(existsSync(file), `${f.family} ${w} has no woff2 at ${file}`).toBe(true);
      }
    }
  });

  it('ships the @fontsource package licence text for every family', () => {
    for (const f of FONT_CATALOGUE) {
      const licence = resolve(ROOT, `node_modules/@fontsource/${f.slug}/LICENSE`);
      expect(existsSync(licence), `${f.family} ships no LICENSE`).toBe(true);
      expect(readFileSync(licence, 'utf8').length).toBeGreaterThan(0);
    }
  });
});

describe('the report font catalogue derives from the repository (F2)', () => {
  it('exposes every report-embeddable family, and only those', () => {
    const expected = FONT_CATALOGUE.filter((f) => f.reportEmbeddable && f.licence.redistributable).map((f) => f.family);
    expect(REPORT_FONT_FAMILIES.map((f) => f.family)).toEqual(expected);
  });

  it('resolves a file stem for every report family', () => {
    for (const f of REPORT_FONT_FAMILIES) {
      expect(fontFileStem(f.family, 400)).toBe(`${f.packageSlug}-latin-400-normal`);
    }
  });
});
