import { describe, expect, it } from 'vitest';
import { deflateSync, gzipSync } from 'node:zlib';

import { inflateRaw, inflateZlib } from './inflate';
import { decodePng, isPng } from './png';
import { recogniseImage, recognisePng, recogniseArabicLine, bundledOcrEngine } from './ocrEngine';
import { OCR_GLYPH_BITS, OCR_GLYPH_H, OCR_GLYPH_W, OCR_ARABIC_BITS } from './ocrFont.generated';
import { encodePng, PixelCanvas } from '../../render/png';
import { runOcr } from './ocr';

/**
 * These tests exercise the real engine, not a mock. `inflate` is checked against Node's own `zlib`;
 * the PNG decoder and the recogniser are checked by rendering text with the in-repo renderer and
 * reading it back. That round trip is the end-to-end proof that the tier-2 engine works.
 */

/**
 * The cell pitch used to render test pages: the glyph width plus a gap, as a real monospace typeface has
 * (the ink of a letter does not fill its advance). The gap is what lets the engine find the cell grid.
 */
const TEST_PITCH = OCR_GLYPH_W + 2;

/** Render ASCII text into a PNG using the engine's own bitmap font, so the round trip is honest. */
function renderText(lines: string[]): Uint8Array {
  const pitch = TEST_PITCH;
  const lineH = OCR_GLYPH_H + 2;
  const cols = Math.max(...lines.map((l) => l.length), 1);
  const width = cols * pitch + 8;
  const height = lines.length * lineH + 8;
  const canvas = new PixelCanvas(width, height, { r: 255, g: 255, b: 255 });
  lines.forEach((line, li) => {
    for (let ci = 0; ci < line.length; ci++) {
      const bits = OCR_GLYPH_BITS[line.charCodeAt(ci)];
      if (!bits) continue;
      const ox = 4 + ci * pitch;
      const oy = 4 + li * lineH;
      for (let gy = 0; gy < OCR_GLYPH_H; gy++) {
        for (let gx = 0; gx < OCR_GLYPH_W; gx++) {
          if (bits[gy * OCR_GLYPH_W + gx] === '1') canvas.fillRect(ox + gx, oy + gy, 1, 1, { r: 0, g: 0, b: 0 });
        }
      }
    }
  });
  return encodePng(canvas.data, width, height);
}

describe('inflate (RFC 1951/1950) against Node zlib', () => {
  const sample = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(20) + '0123456789');

  it('decodes a stored block and a fixed-Huffman block (via the zlib wrapper)', () => {
    for (const level of [0, 1]) {
      const z = deflateSync(sample, { level });
      expect(Buffer.from(inflateZlib(new Uint8Array(z))).toString()).toBe(sample.toString());
    }
  });

  it('decodes dynamic-Huffman blocks (the common case)', () => {
    const z = deflateSync(sample, { level: 9 });
    expect(Buffer.from(inflateZlib(new Uint8Array(z))).toString()).toBe(sample.toString());
  });

  it('decodes a raw DEFLATE stream with no zlib wrapper', () => {
    const z = deflateSync(sample, { level: 6 });
    // A zlib stream is a 2-byte header, a raw DEFLATE stream, then a 4-byte Adler-32.
    const raw = z.subarray(2, z.length - 4);
    expect(Buffer.from(inflateRaw(new Uint8Array(raw))).toString()).toBe(sample.toString());
  });

  it('decodes a gzip member body (raw DEFLATE after the 10-byte header)', () => {
    const g = gzipSync(sample);
    expect(Buffer.from(inflateRaw(new Uint8Array(g.subarray(10)))).toString()).toBe(sample.toString());
  });

  it('round-trips binary bytes, not just text', () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 37) & 0xff));
    const z = deflateSync(bytes, { level: 9 });
    expect(Buffer.from(inflateZlib(new Uint8Array(z)))).toEqual(bytes);
  });
});

describe('PNG decoder', () => {
  it('recognises the PNG signature', () => {
    expect(isPng(renderText(['Hi']))).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('decodes the in-repo encoder output (RGBA, filter 0)', () => {
    const canvas = new PixelCanvas(4, 3, { r: 10, g: 20, b: 30 });
    canvas.fillRect(1, 1, 2, 1, { r: 200, g: 100, b: 0 });
    const png = encodePng(canvas.data, 4, 3);
    const img = decodePng(png);
    expect(img.width).toBe(4);
    expect(img.height).toBe(3);
    // Row 1, col 1 is the orange rect: luma ~ 0.299*200 + 0.587*100 = 118.
    expect(img.gray[1 * 4 + 1]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 0));
  });

  it('refuses an interlaced PNG with a reason rather than guessing', () => {
    const png = renderText(['X']);
    // Flip the interlace byte in IHDR (offset 8 signature + 8 chunk header + 12 = 28).
    const bad = png.slice();
    bad[28] = 1;
    expect(() => decodePng(bad)).toThrow(/interlaced/i);
  });
});

describe('bundled OCR engine — end to end', () => {
  it('reads rendered text back, character for character', async () => {
    const png = renderText(['INVOICE 12345', 'AMOUNT 1234.56', 'VENDOR ACME LTD']);
    const { text, confidence } = await recognisePng(png, { advance: TEST_PITCH });
    expect(text).toBe('INVOICE 12345\nAMOUNT 1234.56\nVENDOR ACME LTD');
    expect(confidence).toBeGreaterThan(0.95);
  });

  it('separates rows and preserves interior spaces', async () => {
    const png = renderText(['A B', 'C']);
    const { text } = await recognisePng(png, { advance: TEST_PITCH });
    expect(text.split('\n')).toEqual(['A B', 'C']);
  });

  it('is a local engine: remote is false, and runOcr accepts it', async () => {
    const engine = bundledOcrEngine({ advance: TEST_PITCH });
    expect(engine.remote).toBe(false);
    const png = renderText(['SIGNED']);
    const out = await runOcr(png, { status: 'unsupported', text: null, kind: 'pdf' }, engine);
    expect(out.status).toBe('done');
    expect(out.text).toBe('SIGNED');
    expect(out.engine).toBe('bundled-bitmap');
  });

  it('fails closed on a blank scan rather than inventing text', async () => {
    const blank = encodePng(new PixelCanvas(60, 40, { r: 255, g: 255, b: 255 }).data, 60, 40);
    const out = await runOcr(blank, { status: 'unsupported', text: null, kind: 'pdf' }, bundledOcrEngine({ advance: TEST_PITCH }));
    expect(out.status).toBe('unsupported');
    expect(out.text).toBeNull();
    expect(out.reason).toMatch(/no text/i);
  });

  it('a caller can see the mean confidence, so a smudged scan is not passed off as clean', async () => {
    // A clean render scores near 1.0; the same engine on noise scores far lower, so the confidence
    // is a real signal a caller can gate on, not a constant.
    const clean = await recognisePng(renderText(['AMOUNT 1234.56']), { advance: TEST_PITCH });
    const canvas = new PixelCanvas(120, 24, { r: 255, g: 255, b: 255 });
    for (let i = 0; i < canvas.width * canvas.height; i += 2) {
      canvas.data[i * 4] = 0; canvas.data[i * 4 + 1] = 0; canvas.data[i * 4 + 2] = 0;
    }
    const noisy = await recognisePng(encodePng(canvas.data, canvas.width, canvas.height), { advance: TEST_PITCH });
    expect(clean.confidence).toBeGreaterThan(0.95);
    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });
});

describe('French (Latin-1 accents)', () => {
  it('reads accented French text back, character for character', async () => {
    const png = renderText(['FACTURE N° 1234', 'MONTANT 1234,56 EUR', 'SOCIÉTÉ GÉNÉRALE']);
    const { text, confidence } = await recognisePng(png, { advance: TEST_PITCH });
    expect(text).toBe('FACTURE N° 1234\nMONTANT 1234,56 EUR\nSOCIÉTÉ GÉNÉRALE');
    expect(confidence).toBeGreaterThan(0.95);
  });

  it('distinguishes e from é and c from ç (the accents are real templates, not dropped)', async () => {
    const plain = await recognisePng(renderText(['e c a u']), { advance: TEST_PITCH });
    const accented = await recognisePng(renderText(['é ç à ù']), { advance: TEST_PITCH });
    expect(plain.text).toBe('e c a u');
    expect(accented.text).toBe('é ç à ù');
  });
});

describe('Arabic script (Arabic, Urdu, Sindhi) — right-to-left', () => {
  /**
   * Render an Arabic-script line into a PNG, right-to-left, packing the glyphs contiguously (as cursive
   * script runs) so the engine must read letters, not spaces.
   */
  function renderArabic(codes: number[]): Uint8Array {
    const shapes = codes.map((cp) => OCR_ARABIC_BITS[cp]).filter(Boolean);
    const width = shapes.reduce((n, t) => n + t.w + 4, 0) + 8;
    const height = 30;
    const canvas = new PixelCanvas(width, height, { r: 255, g: 255, b: 255 });
    let cursor = width - 4; // right edge; letters are laid down right-to-left
    for (const t of shapes) {
      const ox = cursor - t.w;
      const oy = 4;
      for (let r = 0; r < t.h; r++) {
        for (let c = 0; c < t.w; c++) {
          if (t.bits[r * t.w + c] === '1') canvas.fillRect(ox + c, oy + r, 1, 1, { r: 0, g: 0, b: 0 });
        }
      }
      cursor = ox - 4;
    }
    return encodePng(canvas.data, width, height);
  }

  it('reads an Arabic word back in logical order', async () => {
    // س ل ا م  = U+0633 U+0644 U+0627 U+0645 (the logical order of "سلام")
    const img = decodePng(renderArabic([0x0633, 0x0644, 0x0627, 0x0645]));
    const { text, meanScore } = recogniseArabicLine(img);
    expect(text).toBe('سلام');
    expect(meanScore).toBeGreaterThan(0.8);
  });

  it('reads Urdu letters that do not exist in Arabic (e.g. ے, ٹ)', async () => {
    // ا ٹ ے = U+0627 U+0679 U+06D2
    const img = decodePng(renderArabic([0x0627, 0x0679, 0x06d2]));
    const { text } = recogniseArabicLine(img);
    expect(text).toBe('اٹے');
  });

  it('reads Arabic-Indic digits', async () => {
    const img = decodePng(renderArabic([0x0661, 0x0662, 0x0663])); // ١٢٣
    const { text } = recogniseArabicLine(img);
    expect(text).toBe('١٢٣');
  });

  it('fails closed on a blank Arabic page rather than inventing letters', () => {
    const blank = decodePng(encodePng(new PixelCanvas(60, 30, { r: 255, g: 255, b: 255 }).data, 60, 30));
    const { text, meanScore } = recogniseArabicLine(blank);
    expect(text).toBe('');
    expect(meanScore).toBe(0);
  });
});
