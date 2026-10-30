/**
 * Systeligon OCR seam, tier 2 (spec §5). Spec: "OCR (lazy-loaded, bundled). Only for scans and images
 * with no text layer." Three rules fall out of that sentence and this module enforces them:
 *
 *   1. **Only for scans and images with no text layer.** `needsOcr` decides that from the tier-1
 *      outcome — it never OCRs a document that already yielded text.
 *   2. **Lazy-loaded.** The engine is injected by the caller at run time. Nothing here imports an OCR
 *      library, so a build that never OCRs never ships one.
 *   3. **Nothing leaves the tenant.** The engine is a local function of bytes; there is no network
 *      call and no service URL. `runOcr` refuses an engine that declares itself remote.
 *
 * The engine itself (a bundled WASM model and its trained data) is a build artifact, not logic; it is
 * wired here as a dependency so the seam is real and testable without vendoring a multi-megabyte model
 * in this environment. See docs/SCALE-DECISIONS.md (D6).
 */

/** What a tier-1 extractor returned, which is what `needsOcr` reasons about. */
export interface ExtractionHint {
  /** The tier-1 status. `unsupported` is what a PDF with no text layer returns. */
  status: 'done' | 'failed' | 'unsupported' | 'legacy_not_extracted';
  /** The text tier 1 produced, if any. Empty or whitespace means "no text layer". */
  text: string | null;
  /** The document's classified kind, so a scan (image) is distinguished from a legacy binary. */
  kind: 'docx' | 'xlsx' | 'csv' | 'pdf' | 'legacy' | 'unknown';
}

/**
 * Whether OCR should be attempted. True only for a scan: a `pdf` (or an image surfacing as `unknown`)
 * that produced no usable text. A legacy binary is *not* OCR'd — it is a stored format, not a scan.
 */
export function needsOcr(hint: ExtractionHint): boolean {
  if (hint.status === 'failed' || hint.status === 'legacy_not_extracted') return false;
  if (hint.kind !== 'pdf' && hint.kind !== 'unknown') return false;
  return !hint.text || hint.text.trim().length === 0;
}

/** A local OCR engine. It is a pure function of bytes; it must not declare a remote endpoint. */
export interface OcrEngine {
  /** Name for the record, e.g. `tesseract-wasm`. */
  name: string;
  /** True when the engine sends anything off the machine. A remote engine is refused (L2). */
  remote: boolean;
  /**
   * The languages the engine was configured to read, as a tesseract `lang` string (`eng+urd`). A
   * caller sets this from `buildOcrEngineConfig`; when absent the engine's own default is used.
   */
  lang?: string;
  recognize(bytes: Uint8Array): Promise<OcrText>;
}

export interface OcrText {
  text: string;
  /** Mean confidence 0..1 as the engine reports it; null when the engine does not score. */
  confidence: number | null;
}

export interface OcrOutcome {
  status: 'done' | 'unsupported';
  text: string | null;
  engine: string | null;
  reason: string | null;
  /** The `lang` string the engine was configured with, when the run reached the engine. */
  lang?: string;
  /** Requested languages that could not be loaded, so a caller can say so honestly. */
  missing?: { code: string; reason: string }[];
}

/**
 * Run OCR over a scan. Fails closed: with no engine, or a remote engine, or an input that does not
 * need OCR, it returns `unsupported` with the reason — it never invents text and never calls out.
 */
export async function runOcr(bytes: Uint8Array, hint: ExtractionHint, engine: OcrEngine | null | undefined): Promise<OcrOutcome> {
  if (!needsOcr(hint)) {
    return { status: 'unsupported', text: null, engine: null, reason: 'no OCR needed: tier 1 produced text or the file is not a scan' };
  }
  if (!engine) {
    return { status: 'unsupported', text: null, engine: null, reason: 'no OCR engine is bundled; the scan is stored, not read (tier 2 not vendored)' };
  }
  if (engine.remote) {
    return { status: 'unsupported', text: null, engine: engine.name, reason: 'a remote OCR engine is refused: nothing may leave the tenant (L2)' };
  }
  try {
    const result = await engine.recognize(bytes);
    const text = result.text ?? '';
    if (text.trim().length === 0) {
      return { status: 'unsupported', text: null, engine: engine.name, reason: 'OCR produced no text', lang: engine.lang };
    }
    return { status: 'done', text, engine: engine.name, reason: null, lang: engine.lang };
  } catch (e) {
    return { status: 'unsupported', text: null, engine: engine.name, reason: e instanceof Error ? e.message : 'OCR failed', lang: engine.lang };
  }
}

/**
 * Run OCR with an explicit language configuration, reporting any language that could not be loaded.
 * This is the entry point a caller that cares about language uses; `runOcr` remains the seam for a
 * caller that does not. Fails closed exactly as `runOcr` does, and additionally carries the `lang`
 * string and the `missing` list so a scan read in the wrong language is never presented as read.
 */
export async function runOcrWithLanguages(
  bytes: Uint8Array,
  hint: ExtractionHint,
  engine: OcrEngine | null | undefined,
  requestedLanguages: string[],
  availablePacks: import('./ocrLanguages').OcrLanguage['pack'][] = ['core'],
): Promise<OcrOutcome> {
  const { buildOcrEngineConfig } = await import('./ocrLanguages');
  const config = buildOcrEngineConfig(requestedLanguages, availablePacks);
  const configured: OcrEngine | null | undefined = engine ? { ...engine, lang: config.lang } : engine;
  const outcome = await runOcr(bytes, hint, configured);
  return { ...outcome, lang: config.lang, missing: config.missing };
}
