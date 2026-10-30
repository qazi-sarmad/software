/**
 * The bundled OCR engine (spec §5, tier 2). This is the engine `runOcr` was a seam for: a real, local,
 * hard-coded recogniser that reads a scan **inside the tenant** and calls nothing.
 *
 * How it works — all deterministic, no model, no learning:
 *   1. decode the PNG the scan arrived as (in-repo decoder, `png.ts`);
 *   2. binarise by a fixed threshold;
 *   3. find the connected components of the ink;
 *   4. cluster components that touch (a cursive Arabic letter is several strokes) into one letter;
 *   5. normalise each letter to a fixed grid by its own bounding box and match it against the bitmap
 *      font (`ocrFont.generated.ts`), taking the nearest template;
 *   6. rebuild the line, inserting a space where the gap between letters is wide enough, and reversing
 *      the order for a right-to-left script.
 *
 * Bounding-box normalisation is what makes it work on a scan it did not itself render: a letter's
 * position and size on the page do not matter, only its shape. Accents (`é`), descenders (`ç`) and the
 * Arabic script's disconnected strokes all fall out of the same step.
 *
 * It is honest about its own confidence: every letter carries a 0..1 match score and the engine reports
 * the mean, so a caller can tell a clean scan from a smudged one. `remote` is `false` — there is no
 * endpoint to declare, and `runOcr` refuses any engine that says otherwise (L2).
 */
import type { OcrEngine, OcrText } from './ocr';
import { decodePng } from './png';
import { OCR_GLYPH_BITS, OCR_GLYPH_H, OCR_GLYPH_W, OCR_FIRST, OCR_LAST, OCR_ARABIC_BITS } from './ocrFont.generated';

export interface BundledOcrOptions {
  /** Ink threshold 0..255 on the luminance plane; a pixel darker than this is ink. Default 128. */
  threshold?: number;
  /** Minimum letter match score (0..1) to accept; below it the letter is dropped. Default 0.55. */
  minScore?: number;
  /**
   * Horizontal gap (px) at or below which two components belong to the same letter. Latin defaults to
   * -1, so only components that overlap horizontally merge (the dot of `i`, the parts of `%`); two
   * adjacent monospace letters, whose ink can touch, stay separate. Arabic defaults to 2, because a
   * cursive letter is several disconnected strokes.
   */
  letterGap?: number;
  /**
   * The monospace advance in pixels for Latin text. Defaults to the engine's own glyph cell
   * (`OCR_GLYPH_W`). A scan rasterised at a different size passes its own advance.
   */
  advance?: number;
}

/** A recognised letter: the character and its match score, for the confidence report. */
export interface GlyphMatch {
  char: string;
  score: number;
}

/** The side of the square grid every letter and template is normalised onto before comparison. */
const GRID = 12;

interface Template { cp: number; grid: Uint8Array; aspect: number }

/** The ink bounding box of a bit mask, or null when it carries no ink. */
function inkBbox(bits: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bits[r * w + c]) {
        if (c < x0) x0 = c; if (c > x1) x1 = c;
        if (r < y0) y0 = r; if (r > y1) y1 = r;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Resample a region of a mask into a GRID×GRID square (nearest-neighbour, deterministic). */
function gridOf(bits: Uint8Array, w: number, box: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const out = new Uint8Array(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const sx = box.x0 + Math.min(bw - 1, Math.floor((c * bw) / GRID));
      const sy = box.y0 + Math.min(bh - 1, Math.floor((r * bh) / GRID));
      out[r * GRID + c] = bits[sy * w + sx];
    }
  }
  return out;
}

/** Similarity of two normalised grids: 1 - (differing cells / total cells). */
function gridScore(a: Uint8Array, b: Uint8Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return 1 - diff / a.length;
}

/**
 * How a letter and a template differ in shape. The grid score alone cannot tell two small marks apart —
 * `.` and `'` both fill a handful of cells — so the aspect ratio is added as a tiebreak: a dot is as wide
 * as it is tall, an apostrophe is a thin vertical stroke.
 */
function shapeMatch(letter: { grid: Uint8Array; aspect: number }, template: Template): number {
  const aspectPenalty = Math.min(1, Math.abs(letter.aspect - template.aspect)) * 0.25;
  return gridScore(letter.grid, template.grid) - aspectPenalty;
}

function toBits(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  return out;
}

/** Normalise a template's ink to the grid once, at load. */
function templateFromBits(cp: number, bitsStr: string, w: number, h: number): Template | null {
  const bits = toBits(bitsStr);
  const box = inkBbox(bits, w, h);
  if (!box) return null;
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  return { cp, grid: gridOf(bits, w, box), aspect: bw / bh };
}

/** The Latin letters (ASCII plus the accented letters the western European languages need). */
const LATIN_TEMPLATES: Template[] = (() => {
  const out: Template[] = [];
  for (const key of Object.keys(OCR_GLYPH_BITS)) {
    const cp = Number(key);
    const t = templateFromBits(cp, OCR_GLYPH_BITS[cp], OCR_GLYPH_W, OCR_GLYPH_H);
    if (t) out.push(t);
  }
  return out;
})();

const ARABIC_TEMPLATES: Template[] = Object.keys(OCR_ARABIC_BITS)
  .map((key) => {
    const cp = Number(key);
    const t = OCR_ARABIC_BITS[cp];
    return templateFromBits(cp, t.bits, t.w, t.h);
  })
  .filter((t): t is Template => t !== null);

interface Component { x0: number; y0: number; x1: number; y1: number }

/** Connected components of the ink, 8-connected. */
function components(ink: Uint8Array, width: number, height: number): Component[] {
  const seen = new Uint8Array(ink.length);
  const comps: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const y = Math.floor(p / width);
      const x = p - y * width;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (ink[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
    }
    comps.push({ x0, y0, x1, y1 });
  }
  return comps;
}

/** Merge components whose horizontal extents are within `gap` of each other into one letter. */
function cluster(comps: Component[], gap: number): Component[] {
  const sorted = comps.slice().sort((a, b) => a.x0 - b.x0);
  const out: Component[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.x0 - last.x1 <= gap) {
      last.x1 = Math.max(last.x1, c.x1);
      last.y0 = Math.min(last.y0, c.y0);
      last.y1 = Math.max(last.y1, c.y1);
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

interface MatchedLetter { char: string; score: number; x0: number; x1: number }

interface RecognisedLine { matched: MatchedLetter[]; glyphs: GlyphMatch[] }

/**
 * Recognise one monospace line by the advance grid. The line is cut into cells of `advance` pixels; the
 * cell phase is the offset that puts the most ink at cell centres (the gap between cells carries the
 * least). Each cell with ink is matched against the templates; a cell without ink is a space. Cutting by
 * the grid, rather than by connected components, is what keeps two adjacent letters separate when their
 * ink touches at the cell boundary.
 */
function recogniseMonoLine(
  ink: Uint8Array,
  width: number,
  height: number,
  templates: Template[],
  advance: number,
  minScore: number,
): { text: string; glyphs: GlyphMatch[] } {
  // The cell phase: the gap between two monospace cells carries the least ink, so the residue class of
  // columns with the least ink is the cell boundary; the cell starts there. A wrong phase clips a letter
  // (a `T` loses its bar and reads as an `I`).
  const colInk = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) colInk[x] += ink[y * width + x];
  }
  const residueInk = new Array<number>(advance).fill(0);
  for (let x = 0; x < width; x++) residueInk[x % advance] += colInk[x];
  let phase = 0;
  for (let r = 1; r < advance; r++) if (residueInk[r] < residueInk[phase]) phase = r;

  const glyphs: GlyphMatch[] = [];
  let text = '';
  const cells = Math.ceil((width - phase) / advance);
  for (let c = 0; c < cells; c++) {
    const x0 = phase + c * advance;
    const x1 = Math.min(width - 1, x0 + advance - 1);
    if (x1 < x0) continue;
    // The cell's own ink box, so the template is compared on the glyph's shape alone.
    let bx0 = x1 + 1; let by0 = height; let bx1 = -1; let by1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = x0; x <= x1; x++) {
        if (ink[y * width + x]) {
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
          if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
      }
    }
    if (bx1 < 0) { text += ' '; continue; }
    const grid = gridOf(ink, width, { x0: bx0, y0: by0, x1: bx1, y1: by1 });
    const aspect = (bx1 - bx0 + 1) / (by1 - by0 + 1);
    let best: GlyphMatch | null = null;
    for (const t of templates) {
      const score = shapeMatch({ grid, aspect }, t);
      if (!best || score > best.score) best = { char: String.fromCodePoint(t.cp), score };
    }
    if (best && best.score >= minScore) {
      text += best.char;
      glyphs.push(best);
    } else {
      text += ' ';
    }
  }
  return { text: text.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' '), glyphs };
}

/** Recognise one proportional line: cluster strokes into letters and match each against the templates. */
function recogniseLine(
  ink: Uint8Array,
  width: number,
  height: number,
  templates: Template[],
  opts: { minScore: number; gap: number },
): RecognisedLine {
  const letters = cluster(components(ink, width, height), opts.gap);
  const glyphs: GlyphMatch[] = [];
  const matched: MatchedLetter[] = [];

  for (const letter of letters) {
    const grid = gridOf(ink, width, letter);
    const aspect = (letter.x1 - letter.x0 + 1) / (letter.y1 - letter.y0 + 1);
    let best: GlyphMatch | null = null;
    for (const t of templates) {
      const score = shapeMatch({ grid, aspect }, t);
      if (!best || score > best.score) best = { char: String.fromCodePoint(t.cp), score };
    }
    if (best && best.score >= opts.minScore) {
      matched.push({ char: best.char, score: best.score, x0: letter.x0, x1: letter.x1 });
      glyphs.push(best);
    }
  }
  matched.sort((a, b) => a.x0 - b.x0);
  return { matched, glyphs };
}


/**
 * Rebuild a proportional (cursive Arabic) line's text. Letters do not sit on a fixed grid, so a space is
 * judged by the ink gap: a gap at least as wide as the median letter is a space, anything smaller is
 * adjacent strokes of the same word.
 */
function formatLineGaps(matched: MatchedLetter[], rtl: boolean): string {
  const widths = matched.map((m) => m.x1 - m.x0 + 1).sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 1;
  let text = '';
  for (let i = 0; i < matched.length; i++) {
    if (i > 0) {
      const gap = matched[i].x0 - matched[i - 1].x1 - 1;
      if (gap > median) text += ' '.repeat(Math.max(1, Math.round(gap / median)));
    }
    text += matched[i].char;
  }
  if (rtl) text = [...text].reverse().join('');
  return text;
}

/** Binarise the luminance plane: 1 = ink (dark). */
function binarise(gray: Uint8Array, threshold: number): Uint8Array {
  const ink = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) ink[i] = gray[i] < threshold ? 1 : 0;
  return ink;
}

/** The horizontal bands of the image that carry ink, merged across single-row gaps (an accent's mark). */
function bands(ink: Uint8Array, width: number, height: number, lineGap: number): Array<[number, number]> {
  const rowInk = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += ink[y * width + x];
    rowInk[y] = n;
  }
  const out: Array<[number, number]> = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < height; y++) {
    if (rowInk[y] > 0) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap >= lineGap) { out.push([start, y - gap + 1]); start = -1; gap = 0; }
    }
  }
  if (start >= 0) out.push([start, height]);
  return out;
}

/** Crop a horizontal band into its own mask, so each line is recognised independently. */
function cropBand(ink: Uint8Array, width: number, top: number, bottom: number): { bits: Uint8Array; h: number } {
  const h = bottom - top;
  const bits = new Uint8Array(width * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) bits[y * width + x] = ink[(top + y) * width + x];
  }
  return { bits, h };
}

/**
 * Recognise Latin-script text (English, French and the other Latin languages). Rows are separated by
 * blank bands; each row is recognised left-to-right. Returns the text (rows joined by `\n`) and the mean
 * letter score.
 */
export function recogniseImage(
  image: { width: number; height: number; gray: Uint8Array },
  options: BundledOcrOptions = {},
): { text: string; meanScore: number; glyphs: GlyphMatch[] } {
  const { width, height, gray } = image;
  const ink = binarise(gray, options.threshold ?? 128);
  const advance = options.advance ?? OCR_GLYPH_W;
  const glyphs: GlyphMatch[] = [];
  const lines: string[] = [];
  for (const [top, bottom] of bands(ink, width, height, 2)) {
    const { bits, h } = cropBand(ink, width, top, bottom);
    const r = recogniseMonoLine(bits, width, h, LATIN_TEMPLATES, advance, options.minScore ?? 0.55);
    lines.push(r.text);
    glyphs.push(...r.glyphs);
  }
  const meanScore = glyphs.length ? glyphs.reduce((s, g) => s + g.score, 0) / glyphs.length : 0;
  return { text: lines.join('\n'), meanScore, glyphs };
}

/**
 * The bundled engine as `runOcr` wants it: a local `OcrEngine` whose `recognize` decodes a PNG and
 * matches the bitmap font. `remote: false` — nothing leaves the tenant.
 */
/**
 * Recognise an Arabic-script line (Arabic, Urdu, Sindhi). The script is cursive and right-to-left, so
 * strokes are clustered with a wider gap and the result is reversed. Returns the logical-order text and
 * the mean letter score.
 */
export function recogniseArabicLine(
  image: { width: number; height: number; gray: Uint8Array },
  options: BundledOcrOptions = {},
): { text: string; meanScore: number } {
  const { width, height, gray } = image;
  const ink = binarise(gray, options.threshold ?? 128);
  const parts: string[] = [];
  const glyphs: GlyphMatch[] = [];
  for (const [top, bottom] of bands(ink, width, height, 2)) {
    const { bits, h } = cropBand(ink, width, top, bottom);
    const r = recogniseLine(bits, width, h, ARABIC_TEMPLATES, {
      minScore: options.minScore ?? 0.55,
      gap: options.letterGap ?? 2,
    });
    parts.push(formatLineGaps(r.matched, true));
    glyphs.push(...r.glyphs);
  }
  const meanScore = glyphs.length ? glyphs.reduce((s, g) => s + g.score, 0) / glyphs.length : 0;
  return { text: parts.join('\n'), meanScore };
}

export function bundledOcrEngine(options: BundledOcrOptions = {}): OcrEngine {
  return {
    name: 'bundled-bitmap',
    remote: false,
    async recognize(bytes: Uint8Array): Promise<OcrText> {
      const image = decodePng(bytes);
      const { text, meanScore } = recogniseImage(image, options);
      return { text, confidence: meanScore };
    },
  };
}

/** Recognise a PNG scan directly, returning the text and the mean score. */
export async function recognisePng(bytes: Uint8Array, options: BundledOcrOptions = {}): Promise<{ text: string; confidence: number }> {
  const image = decodePng(bytes);
  const { text, meanScore } = recogniseImage(image, options);
  return { text, confidence: meanScore };
}
