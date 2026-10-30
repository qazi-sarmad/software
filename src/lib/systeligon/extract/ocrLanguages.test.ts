import { describe, expect, it } from 'vitest';
import {
  OCR_LANGUAGES, OCR_ENGINE_CHOICES, DEFAULT_OCR_LANGUAGE,
  buildOcrEngineConfig, defaultOcrEngineConfig, ocrLanguage, packFontTables,
} from './ocrLanguages';

describe('OCR language layer (S7 tier 2)', () => {
  it('declares the requested scripts: Urdu, Sindhi (Arabic), Arabic and French', () => {
    const codes = OCR_LANGUAGES.map((l) => l.code);
    for (const c of ['urd', 'snd', 'ara', 'fra']) expect(codes).toContain(c);
    // Urdu, Sindhi and Arabic are the Arabic script and right-to-left.
    for (const c of ['urd', 'snd', 'ara']) {
      expect(ocrLanguage(c)!.script).toBe('arabic');
      expect(ocrLanguage(c)!.direction).toBe('rtl');
    }
    expect(ocrLanguage('fra')!.script).toBe('latin');
  });

  it('builds a combined lang string in the order requested, core before nothing invented', () => {
    const cfg = buildOcrEngineConfig(['eng', 'urd'], ['core', 'extended']);
    expect(cfg.lang).toBe('eng+urd');
    expect(cfg.tables).toEqual(['latin', 'arabic']);
    expect(cfg.rtl).toBe(true);
    expect(cfg.scripts).toEqual(['latin', 'arabic']);
    expect(cfg.missing).toEqual([]);
  });

  it('reports an unvendored pack as missing rather than silently falling back to English', () => {
    const cfg = buildOcrEngineConfig(['urd'], ['core']);
    expect(cfg.missing).toEqual([{ code: 'urd', reason: expect.stringContaining("'extended' language pack is not vendored") }]);
    // The run still loads a real language (English) rather than failing with an empty lang string.
    expect(cfg.lang).toBe('eng');
  });

  it('reports an unknown code as missing and never substitutes it', () => {
    const cfg = buildOcrEngineConfig(['eng', 'klingon'], ['core']);
    expect(cfg.lang).toBe('eng');
    expect(cfg.missing).toEqual([{ code: 'klingon', reason: expect.stringContaining('not in the bundled language catalogue') }]);
  });

  it('defaults to English deterministically', () => {
    expect(defaultOcrEngineConfig().lang).toBe(DEFAULT_OCR_LANGUAGE);
    expect(buildOcrEngineConfig([]).lang).toBe('eng');
  });

  it('packFontTables lists exactly the tables a pack must ship', () => {
    expect(packFontTables('core')).toContain('latin');
    expect(packFontTables('core')).not.toContain('arabic');
    expect(packFontTables('extended')).toContain('arabic');
  });

  it('every engine choice is bundled and free (nothing leaves the tenant)', () => {
    for (const e of OCR_ENGINE_CHOICES) {
      expect(e.bundled).toBe(true);
      expect(e.arabicScript).toBe(true);
      expect(e.name).toBe('bundled-bitmap');
    }
  });
});
