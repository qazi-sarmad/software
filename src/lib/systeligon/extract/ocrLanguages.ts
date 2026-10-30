/**
 * Systeligon OCR language layer (S7, tier 2). The seam in `ocr.ts` decides *whether* to OCR; this
 * decides *in what language*. It is the catalogue of what a bundled engine can read, and the pure
 * function that turns "this org works in English and Sindhi" into the traineddata set the engine
 * loads — and into an honest statement of what could not be loaded.
 *
 * Three rules, all from the spec's "OCR (lazy-loaded, bundled)":
 *
 *   1. **Bundled, never remote.** The languages here are traineddata files that ship in the bundle.
 *      There is no download URL and no service; a language that is not vendored is reported, not fetched.
 *   2. **Script-aware.** A language is a language *and* a script. Urdu, Sindhi and Arabic share the
 *      Arabic script; the engine must be told to combine script and language, and a right-to-left
 *      script needs its direction declared so the extracted text is not reversed.
 *   3. **Honest coverage.** Requesting a language that is not available returns it in `missing` with a
 *      reason. The engine never silently falls back to English and never pretends a scan was read.
 *
 * The engine itself (a WASM build of the free, Apache-2.0 `tesseract` and its traineddata) is a build
 * artifact, not logic; this module is the interface a caller configures it through. See
 * docs/SCALE-DECISIONS.md (D6).
 */

/** The scripts a bundled OCR engine may read. Arabic covers Arabic, Urdu and Sindhi. */
export type OcrScript = 'latin' | 'arabic' | 'devanagari' | 'cjk' | 'cyrillic' | 'hebrew' | 'greek';

/** The writing direction of a script. Arabic-script text is right-to-left. */
export type OcrDirection = 'ltr' | 'rtl';

/**
 * One language the bundled engine can read. `code` is the ISO 639-1/639-3 code the engine expects in
 * its `lang` string; `traineddata` is the file the bundle must carry for it to load.
 */
export interface OcrLanguage {
  code: string;
  /** The English name, for the picker. */
  name: string;
  /** The name in the language itself, for the picker when the reader speaks it. */
  nativeName: string;
  script: OcrScript;
  direction: OcrDirection;
  /** The traineddata file name the engine loads, e.g. `eng.traineddata`. */
  traineddata: string;
  /**
   * The pack the file ships in. `core` is always vendored; `extended` is an opt-in bundle so a tenant
   * that never reads Urdu does not ship the Urdu model. A language in a pack that is not vendored is
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
  { code: 'eng', name: 'English', nativeName: 'English', script: 'latin', direction: 'ltr', traineddata: 'eng.traineddata', pack: 'core', quality: 'high' },
  { code: 'fra', name: 'French', nativeName: 'Français', script: 'latin', direction: 'ltr', traineddata: 'fra.traineddata', pack: 'core', quality: 'high' },
  { code: 'ara', name: 'Arabic', nativeName: 'العربية', script: 'arabic', direction: 'rtl', traineddata: 'ara.traineddata', pack: 'extended', quality: 'good' },
  { code: 'urd', name: 'Urdu', nativeName: 'اردو', script: 'arabic', direction: 'rtl', traineddata: 'urd.traineddata', pack: 'extended', quality: 'good' },
  { code: 'snd', name: 'Sindhi', nativeName: 'سنڌي', script: 'arabic', direction: 'rtl', traineddata: 'snd.traineddata', pack: 'extended', quality: 'fair' },
  // Common companions a multi-lingual tenant needs, declared so the picker is not a two-item list.
  { code: 'deu', name: 'German', nativeName: 'Deutsch', script: 'latin', direction: 'ltr', traineddata: 'deu.traineddata', pack: 'core', quality: 'high' },
  { code: 'spa', name: 'Spanish', nativeName: 'Español', script: 'latin', direction: 'ltr', traineddata: 'spa.traineddata', pack: 'core', quality: 'high' },
  { code: 'hin', name: 'Hindi', nativeName: 'हिन्दी', script: 'devanagari', direction: 'ltr', traineddata: 'hin.traineddata', pack: 'extended', quality: 'good' },
];

/** The default when a caller names no language: English. Deterministic, never guessed from content. */
export const DEFAULT_OCR_LANGUAGE = 'eng';

/** Look a language up by code. */
export function ocrLanguage(code: string): OcrLanguage | undefined {
  return OCR_LANGUAGES.find((l) => l.code === code);
}

/** The traineddata files that must be vendored for a pack to be usable. */
export function packTraineddata(pack: OcrLanguage['pack']): string[] {
  return OCR_LANGUAGES.filter((l) => l.pack === pack).map((l) => l.traineddata);
}

/** What the engine is told to load, and what could not be loaded. */
export interface OcrEngineConfig {
  /** The `lang` string for tesseract: codes joined with `+`, core before extended, e.g. `eng+urd`. */
  lang: string;
  /** The traineddata files the bundle must carry for `lang` to load. */
  files: string[];
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
 * the truth until the pack is added to the bundle.
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
    files: chosen.map((l) => l.traineddata),
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
 * The free OCR engines the seam can host, in preference order. All are Apache-2.0 or MIT and run
 * entirely in the browser via WebAssembly, so nothing leaves the tenant (L2). This is data so the
 * choice is reviewable, not buried in a build script.
 */
export interface OcrEngineChoice {
  name: string;
  licence: string;
  /** Whether it runs from a WASM binary in the bundle (never a network call). */
  bundled: boolean;
  /** Whether it supports the Arabic script (Arabic, Urdu, Sindhi). */
  arabicScript: boolean;
  note: string;
}

export const OCR_ENGINE_CHOICES: OcrEngineChoice[] = [
  {
    name: 'tesseract-wasm',
    licence: 'Apache-2.0',
    bundled: true,
    arabicScript: true,
    note: 'The free tesseract engine compiled to WASM. Reads the Arabic script (Arabic/Urdu/Sindhi) from traineddata, ships in the bundle, and needs no service. The preferred engine.',
  },
  {
    name: 'tesseract.js',
    licence: 'Apache-2.0',
    bundled: true,
    arabicScript: true,
    note: 'The same engine behind a worker. Heavier but battle-tested; use when a worker is preferred over a synchronous WASM call.',
  },
];
