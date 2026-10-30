/**
 * Systeligon OCR language layer (S7, tier 2). The seam in `ocr.ts` decides *whether* to OCR; this
 * decides *in what language*. It is the catalogue of what the bundled engine can read, and the pure
 * function that turns "this org works in English and Sindhi" into the font tables the engine must load
 * — and into an honest statement of what could not be loaded.
 *
 * The engine itself is `ocrEngine.ts`: a deterministic bitmap recogniser (no model, no learning, no
 * network — L1, L2). What a language needs from the bundle is not a trained model but a **bitmap font
 * table**: `latin` (the Latin-1 glyphs) and `arabic` (the Arabic-script glyphs Arabic, Urdu and Sindhi
 * share). Those tables are the generated `ocrFont.generated.ts`.
 *
 * Three rules, all from the spec's "OCR (lazy-loaded, bundled)":
 *
 *   1. **Bundled, never remote.** The tables ship in the bundle. There is no download URL and no
 *      service; a language whose table is not vendored is reported, not fetched.
 *   2. **Script-aware.** A language is a language *and* a script. Urdu, Sindhi and Arabic share the
 *      Arabic script and are right-to-left, so the engine must reverse their runs.
 *   3. **Honest coverage.** Requesting a language that is not available returns it in `missing` with a
 *      reason. The engine never silently falls back to English and never pretends a scan was read.
 */

/** The scripts a bundled OCR engine may read. Arabic covers Arabic, Urdu and Sindhi. */
export type OcrScript = 'latin' | 'arabic' | 'devanagari' | 'cjk' | 'cyrillic' | 'hebrew' | 'greek';

/** The writing direction of a script. Arabic-script text is right-to-left. */
export type OcrDirection = 'ltr' | 'rtl';

/** The bitmap font table a language's script is read with. */
export type OcrFontTable = 'latin' | 'arabic';

/**
 * One language the bundled engine can read. `code` is the ISO 639-1/639-3 code the engine expects in
 * its `lang` string; `fontTable` is the bitmap table the bundle must carry for it to be read.
 */
export interface OcrLanguage {
  code: string;
  /** The English name, for the picker. */
  name: string;
  /** The name in the language itself, for the picker when the reader speaks it. */
  nativeName: string;
  script: OcrScript;
  direction: OcrDirection;
  /** The bitmap font table the engine reads this language with, e.g. `arabic`. */
  fontTable: OcrFontTable;
  /**
   * The pack the table ships in. `core` is always vendored; `extended` is an opt-in bundle so a tenant
   * that never reads Urdu does not ship the Arabic table. A language in a pack that is not vendored is
   * reported missing, never fetched.
   */
  pack: 'core' | 'extended';
  /** Rough accuracy band for a clean scan, so the UI can set expectations honestly. */
  quality: 'high' | 'good' | 'fair';
}

/**
 * The catalogue. Latin core is always vendored; the requested scripts — Urdu, Sindhi (Arabic), Arabic
 * and French — are declared here, with their direction and pack, so the picker and the engine agree.
 */
export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', name: 'English', nativeName: 'English', script: 'latin', direction: 'ltr', fontTable: 'latin', pack: 'core', quality: 'high' },
  { code: 'fra', name: 'French', nativeName: 'Français', script: 'latin', direction: 'ltr', fontTable: 'latin', pack: 'core', quality: 'high' },
  { code: 'ara', name: 'Arabic', nativeName: 'العربية', script: 'arabic', direction: 'rtl', fontTable: 'arabic', pack: 'extended', quality: 'good' },
  { code: 'urd', name: 'Urdu', nativeName: 'اردو', script: 'arabic', direction: 'rtl', fontTable: 'arabic', pack: 'extended', quality: 'good' },
  { code: 'snd', name: 'Sindhi', nativeName: 'سنڌي', script: 'arabic', direction: 'rtl', fontTable: 'arabic', pack: 'extended', quality: 'fair' },
  // Common companions a multi-lingual tenant needs, declared so the picker is not a two-item list.
  { code: 'deu', name: 'German', nativeName: 'Deutsch', script: 'latin', direction: 'ltr', fontTable: 'latin', pack: 'core', quality: 'high' },
  { code: 'spa', name: 'Spanish', nativeName: 'Español', script: 'latin', direction: 'ltr', fontTable: 'latin', pack: 'core', quality: 'high' },
];

/** The default when a caller names no language: English. Deterministic, never guessed from content. */
export const DEFAULT_OCR_LANGUAGE = 'eng';

/** Look a language up by code. */
export function ocrLanguage(code: string): OcrLanguage | undefined {
  return OCR_LANGUAGES.find((l) => l.code === code);
}

/** The bitmap font tables that must be vendored for a pack to be usable. */
export function packFontTables(pack: OcrLanguage['pack']): OcrFontTable[] {
  return [...new Set(OCR_LANGUAGES.filter((l) => l.pack === pack).map((l) => l.fontTable))];
}

/** What the engine is told to load, and what could not be loaded. */
export interface OcrEngineConfig {
  /** The `lang` string for the record: codes joined with `+`, in request order, e.g. `eng+urd`. */
  lang: string;
  /** The bitmap font tables the bundle must carry for `lang` to be read. */
  tables: OcrFontTable[];
  /** The scripts present, so a caller can warn when mixing directions in one page. */
  scripts: OcrScript[];
  /** True when any requested language is right-to-left, so the result text needs RTL handling. */
  rtl: boolean;
  /** Requested codes that are not in the catalogue or whose pack is not vendored. */
  missing: { code: string; reason: string }[];
}

/**
 * Turn a set of requested language codes into the engine configuration. Pure and total: an unknown
 * code is reported in `missing`, never dropped silently and never substituted with English.
 *
 * `availablePacks` is what the build actually vendored. The default — core only — means the Arabic
 * scripts are reported missing with the reason "the extended language pack is not vendored", which is
 * the truth until the Arabic table is added to the bundle.
 */
export function buildOcrEngineConfig(
  requested: string[],
  availablePacks: OcrLanguage['pack'][] = ['core'],
): OcrEngineConfig {
  const codes = requested.length ? requested : [DEFAULT_OCR_LANGUAGE];
  const missing: OcrEngineConfig['missing'] = [];
  const seen = new Set<string>();
  const chosen: OcrLanguage[] = [];

  for (const raw of codes) {
    const code = raw.trim().toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const lang = ocrLanguage(code);
    if (!lang) {
      missing.push({ code, reason: `not in the bundled language catalogue (${OCR_LANGUAGES.length} languages)` });
      continue;
    }
    if (!availablePacks.includes(lang.pack)) {
      missing.push({ code, reason: `the '${lang.pack}' language pack is not vendored in this build` });
      continue;
    }
    chosen.push(lang);
  }

  // A run must load at least one language; if every request missed, fall back to English explicitly.
  if (chosen.length === 0) {
    const eng = ocrLanguage(DEFAULT_OCR_LANGUAGE)!;
    chosen.push(eng);
  }

  const scripts = [...new Set(chosen.map((l) => l.script))];
  return {
    lang: chosen.map((l) => l.code).join('+'),
    tables: [...new Set(chosen.map((l) => l.fontTable))],
    scripts,
    rtl: chosen.some((l) => l.direction === 'rtl'),
    missing,
  };
}

/** The default configuration: English only, core pack. */
export function defaultOcrEngineConfig(): OcrEngineConfig {
  return buildOcrEngineConfig([DEFAULT_OCR_LANGUAGE], ['core']);
}

/**
 * The OCR engines the seam can host, in preference order. The bundled engine is the deterministic
 * bitmap recogniser in `ocrEngine.ts`: no model, no learning, no network, so nothing leaves the tenant
 * (L1, L2). This is data so the choice is reviewable, not buried in a build script.
 */
export interface OcrEngineChoice {
  name: string;
  licence: string;
  /** Whether it runs from code in the bundle (never a network call). */
  bundled: boolean;
  /** Whether it supports the Arabic script (Arabic, Urdu, Sindhi). */
  arabicScript: boolean;
  note: string;
}

export const OCR_ENGINE_CHOICES: OcrEngineChoice[] = [
  {
    name: 'bundled-bitmap',
    licence: 'in-repo',
    bundled: true,
    arabicScript: true,
    note: 'The bundled deterministic recogniser (src/lib/systeligon/extract/ocrEngine.ts). Bitmap-font matching: no model, no learning, no network. Reads the Latin and Arabic scripts from the generated font tables. The engine the product ships.',
  },
];
