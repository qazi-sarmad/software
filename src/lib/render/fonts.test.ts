import { describe, expect, it } from 'vitest';
import {
  REPORT_FONT_FAMILIES, REPORT_FONT_NAMES, DEFAULT_FONT_BODY, DEFAULT_FONT_HEADING,
  isAllowedFontFamily, fontFamily, resolveWeight, fontFileStem,
} from './fonts';

describe('the self-hosted report font catalogue (WP-F)', () => {
  it('offers both a sans and a serif set, and every family is a real @fontsource face', () => {
    expect(REPORT_FONT_FAMILIES.some((f) => f.category === 'sans')).toBe(true);
    expect(REPORT_FONT_FAMILIES.some((f) => f.category === 'serif')).toBe(true);
    for (const f of REPORT_FONT_FAMILIES) {
      expect(f.packageSlug.length).toBeGreaterThan(0);
      expect(f.weights.length).toBeGreaterThan(0);
      // The default weights the UI loads must be shipped by the package.
      expect(f.weights).toContain(400);
    }
  });

  it('exposes a stable, de-duplicated name list for the picker', () => {
    expect(REPORT_FONT_NAMES).toEqual(REPORT_FONT_FAMILIES.map((f) => f.family));
    expect(new Set(REPORT_FONT_NAMES).size).toBe(REPORT_FONT_NAMES.length);
  });

  it('accepts only catalogue families', () => {
    expect(isAllowedFontFamily('Inter')).toBe(true);
    expect(isAllowedFontFamily('Source Serif 4')).toBe(true);
    expect(isAllowedFontFamily('Comic Sans MS')).toBe(false);
    expect(isAllowedFontFamily('')).toBe(false);
    expect(fontFamily('Lora')?.category).toBe('serif');
    expect(fontFamily('Nope')).toBeUndefined();
  });

  it('resolves a requested weight to the nearest shipped weight', () => {
    expect(resolveWeight('Inter', 400)).toBe(400);
    expect(resolveWeight('Inter', 700)).toBe(700);
    // Libre Baskerville ships only 400, so a request for 700 resolves to 400.
    expect(resolveWeight('Libre Baskerville', 700)).toBe(400);
    // IBM Plex Sans ships 400 and 600; 700 resolves to 600.
    expect(resolveWeight('IBM Plex Sans', 700)).toBe(600);
    expect(resolveWeight('Unknown Face', 600)).toBe(400);
  });

  it('derives the exact @fontsource file stem, and refuses an unknown family', () => {
    expect(fontFileStem('Inter', 400)).toBe('inter-latin-400-normal');
    expect(fontFileStem('Source Serif 4', 600)).toBe('source-serif-4-latin-600-normal');
    expect(fontFileStem('Libre Baskerville', 700)).toBe('libre-baskerville-latin-400-normal');
    expect(() => fontFileStem('Helvetica', 400)).toThrow(/unknown font family/);
  });

  it('has defaults that are in the catalogue', () => {
    expect(isAllowedFontFamily(DEFAULT_FONT_HEADING)).toBe(true);
    expect(isAllowedFontFamily(DEFAULT_FONT_BODY)).toBe(true);
  });
});
