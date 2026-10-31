#!/usr/bin/env node
/**
 * Generate the OCR engine's bitmap font from a bundled TTF.
 *
 * The tier-2 engine recognises text by template matching against a bitmap font it carries itself
 * (spec §5: the engine is "bundled, not called"). This script rasterises that font — one 8x14 cell per
 * printable ASCII code point — from DejaVu Sans Mono (Bitstream Vera / public-domain-derived, freely
 * redistributable) using the `@pdf-lib/fontkit` already in the tree. It writes a data module; it is a
 * build step, not runtime code, so nothing here ships in the app bundle.
 *
 * Deterministic: the same TTF produces the same module, byte for byte.
 *
 *   node scripts/gen-ocr-font.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const fontkit = require('@pdf-lib/fontkit');
const fk = fontkit.default ?? fontkit;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const TTF = process.env.OCR_FONT_TTF || '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf';
const ARABIC_TTF = process.env.OCR_ARABIC_TTF || resolve(ROOT, 'scripts/assets/NotoNaskhArabic-Regular.ttf');
const OUT = resolve(ROOT, 'src/lib/systeligon/extract/ocrFont.generated.ts');

const GLYPH_W = 8;
const GLYPH_H = 16;
const BASELINE = 12;
const FIRST = 32;
const LAST = 126;

// Latin-1 letters (French and the other western European languages the product reads). DejaVu Sans
// Mono covers all of Latin-1, so they come from the same font and cell shape.
const LATIN1 = [];
for (let cp = 0xc0; cp <= 0xff; cp++) LATIN1.push(cp);
for (let cp = 0xa0; cp <= 0xbf; cp++) LATIN1.push(cp); // ° £ § © etc. — a scan of an invoice carries them
for (const cp of [0x152, 0x153, 0x178, 0x192, 0x1e9e]) LATIN1.push(cp); // OE oe Ydieresis florin, sharp s

// Arabic-script letters (Arabic, Urdu, Sindhi share the script). Base code points; the generator
// renders each one's isolated form and the recogniser maps a matched form back to the base letter.
const ARABIC_BASE = [
  0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, 0x0628, 0x0629, 0x062a, 0x062b, 0x062c,
  0x062d, 0x062e, 0x062f, 0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638,
  0x0639, 0x063a, 0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x0649, 0x064a,
  // Urdu / Sindhi specific
  0x0679, 0x067e, 0x0686, 0x0688, 0x0691, 0x0698, 0x06a9, 0x06af, 0x06ba, 0x06be, 0x06c1, 0x06c3,
  0x06cc, 0x06d2, 0x06d3, 0x068c, 0x068d, 0x0693, 0x06b3, 0x06bc, 0x06c0, 0x06c9,
];
// Arabic-Indic (0x0660) and Extended Arabic-Indic (0x06F0) digits.
const ARABIC_DIGITS = [];
for (let cp = 0x0660; cp <= 0x0669; cp++) ARABIC_DIGITS.push(cp);
for (let cp = 0x06f0; cp <= 0x06f9; cp++) ARABIC_DIGITS.push(cp);

// The Arabic matcher normalises every glyph to a fixed grid (proportional, cursive script), so a
// template's own advance width and bbox do not matter — only its shape.
const ARAB_W = 14;
const ARAB_H = 18;

const font = fk.create(readFileSync(TTF));
// A monospace cell is one advance width wide; scale the outline so the cell fills GLYPH_W exactly.
const sampleGlyph = font.glyphForCodePoint(65);
const scale = GLYPH_W / sampleGlyph.advanceWidth;

const arabicFont = ARABIC_TTF ? fk.create(readFileSync(ARABIC_TTF)) : null;
const arabScale = arabicFont ? ARAB_W / arabicFont.unitsPerEm : 0;

/** Point-in-contours test with the nonzero winding rule (handles holes in 'o', 'e', 'a'). */
function inside(x, y, contours) {
  let winding = 0;
  for (const poly of contours) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] <= y) {
        if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) winding++;
      } else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) {
        winding--;
      }
    }
  }
  return winding !== 0;
}

/** Flatten a glyph outline into polygons, scaled and placed with the baseline at `baselineY`. */
function contoursOfGlyph(glyph, sc, baselineY) {
  const polys = [];
  let cur = null;
  let cx = 0;
  let cy = 0;
  const STEPS = 8;

  const quad = (x0, y0, qx, qy, x1, y1) => {
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const mt = 1 - t;
      cur.push([mt * mt * x0 + 2 * mt * t * qx + t * t * x1, mt * mt * y0 + 2 * mt * t * qy + t * t * y1]);
    }
  };
  const cubic = (x0, y0, a1x, a1y, a2x, a2y, x1, y1) => {
    for (let i = 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const mt = 1 - t;
      cur.push([
        mt * mt * mt * x0 + 3 * mt * mt * t * a1x + 3 * mt * t * t * a2x + t * t * t * x1,
        mt * mt * mt * y0 + 3 * mt * mt * t * a1y + 3 * mt * t * t * a2y + t * t * t * y1,
      ]);
    }
  };

  for (const cmd of glyph.path.commands) {
    const a = cmd.args;
    if (cmd.command === 'moveTo') {
      cur = [[a[0], a[1]]];
      polys.push(cur);
      cx = a[0]; cy = a[1];
    } else if (cmd.command === 'lineTo') {
      cur.push([a[0], a[1]]);
      cx = a[0]; cy = a[1];
    } else if (cmd.command === 'quadraticCurveTo') {
      quad(cx, cy, a[0], a[1], a[2], a[3]);
      cx = a[2]; cy = a[3];
    } else if (cmd.command === 'bezierCurveTo') {
      cubic(cx, cy, a[0], a[1], a[2], a[3], a[4], a[5]);
      cx = a[4]; cy = a[5];
    } else if (cmd.command === 'closePath') {
      cur = null;
    } else {
      throw new Error(`gen-ocr-font: unsupported path command "${cmd.command}"`);
    }
  }
  // Font units -> cell units: x by scale, y with the baseline at BASELINE (y grows downward).
  return polys
    .filter((p) => p.length >= 3)
    .map((p) => p.map(([px, py]) => [px * sc, baselineY - py * sc]));
}

function bitsFor(codePoint) {
  const glyph = font.glyphForCodePoint(codePoint);
  if (!glyph || !glyph.path || glyph.path.commands.length === 0) {
    return '0'.repeat(GLYPH_W * GLYPH_H);
  }
  const contours = contoursOfGlyph(glyph, scale, BASELINE);
  let bits = '';
  for (let r = 0; r < GLYPH_H; r++) {
    const y = r + 0.5;
    for (let c = 0; c < GLYPH_W; c++) {
      bits += inside(c + 0.5, y, contours) ? '1' : '0';
    }
  }
  return bits;
}

const entries = [];
for (let cp = FIRST; cp <= LAST; cp++) {
  entries.push(`  ${cp}: '${bitsFor(cp)}',`);
}
for (const cp of LATIN1) {
  const bits = bitsFor(cp);
  if (bits.includes('1')) entries.push(`  ${cp}: '${bits}',`);
}

/** Arabic: render a code point's isolated form into a normalised grid; return its own w/h and bits. */
function arabBits(cp) {
  const glyph = arabicFont.glyphForCodePoint(cp);
  if (!glyph || !glyph.path || glyph.path.commands.length === 0) return null;
  const baselineY = ARAB_H * 0.72;
  const contours = contoursOfGlyph(glyph, arabScale, baselineY);
  const bbox = glyph.bbox;
  const w = (bbox.maxX - bbox.minX) * arabScale;
  const h = (bbox.maxY - bbox.minY) * arabScale;
  const cw = Math.min(ARAB_W, Math.max(1, Math.ceil(w)));
  const chh = Math.min(ARAB_H, Math.max(1, Math.ceil(h)));
  // The contour's y for a glyph unit height u is baselineY - u*scale, so the top of the bbox sits at
  // baselineY - maxY*scale; sampling row r steps down from there.
  const top = baselineY - bbox.maxY * arabScale;
  let bits = '';
  for (let r = 0; r < chh; r++) {
    for (let c = 0; c < cw; c++) {
      const px = bbox.minX * arabScale + c + 0.5;
      const py = top + r + 0.5;
      bits += inside(px, py, contours) ? '1' : '0';
    }
  }
  return bits.includes('1') ? { w: cw, h: chh, bits } : null;
}

const arabEntries = [];
if (arabicFont) {
  for (const cp of [...new Set([...ARABIC_BASE, ...ARABIC_DIGITS])]) {
    const shape = arabBits(cp);
    if (shape) arabEntries.push(`  ${cp}: { w: ${shape.w}, h: ${shape.h}, bits: '${shape.bits}' },`);
  }
}

const banner = `/**
 * The OCR engine's bitmap font — GENERATED, do not edit by hand.
 *
 * Latin: DejaVu Sans Mono (freely redistributable). Arabic script: Noto Naskh Arabic (OFL), vendored
 * at scripts/assets/NotoNaskhArabic-Regular.ttf. Regenerate with \`node scripts/gen-ocr-font.mjs\`.
 *
 * Latin glyphs are one ${GLYPH_W}x${GLYPH_H} cell per code point, row-major, \`1\` = ink, baseline row
 * ${BASELINE}. Arabic-script glyphs are bounding-box normalised to at most ${ARAB_W}x${ARAB_H} and are
 * matched as shapes (the script is cursive and proportional, so a fixed cell would be wrong). The
 * engine matches a scan's cells against these; it is data, not logic.
 */

export const OCR_GLYPH_W = ${GLYPH_W};
export const OCR_GLYPH_H = ${GLYPH_H};
export const OCR_BASELINE = ${BASELINE};
export const OCR_FIRST = ${FIRST};
export const OCR_LAST = ${LAST};

/** Arabic-script cell bounds: a matched glyph's own width/height are in its bit string. */
export const OCR_ARABIC_W = ${ARAB_W};
export const OCR_ARABIC_H = ${ARAB_H};

/** Code point -> bit string (row-major, '1' = ink). Latin cells are ${GLYPH_W}x${GLYPH_H}. */
export const OCR_GLYPH_BITS: Record<number, string> = {
${entries.join('\n')}
};

/** Code point -> bit string for the Arabic script (Arabic, Urdu, Sindhi) and its digits. */
export const OCR_ARABIC_BITS: Record<number, { w: number; h: number; bits: string }> = {
${arabEntries.join('\n')}
};
`;

writeFileSync(OUT, banner);
console.log(`gen-ocr-font: wrote ${OUT} (${LAST - FIRST + 1} glyphs, ${GLYPH_W}x${GLYPH_H})`);
