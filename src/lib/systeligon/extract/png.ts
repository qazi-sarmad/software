/**
 * PNG decoder for the bundled OCR engine. A scan arrives as a PNG; to read it the engine must decode
 * it locally. There is no `canvas` and no image library in the tenant, so this is a small, complete
 * decoder built on the in-repo DEFLATE decompressor (`inflate.ts`).
 *
 * It produces a single 8-bit luminance plane, which is all a recogniser needs, and it supports the
 * forms a real scan or screenshot uses: grayscale, palette, RGB and their alpha variants, at 8 and 16
 * bits (16-bit is reduced to 8), and 1/2/4-bit grayscale and palette. Interlacing is refused with a
 * reason rather than decoded wrongly — an image the engine cannot read must be reported unreadable,
 * never guessed at.
 */
import { inflateZlib } from './inflate';

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major 8-bit luminance, length `width * height`. */
  gray: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

/** Whether the bytes start with the PNG signature. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((s, i) => bytes[i] === s);
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlace: number;
}

function parseHeader(ihdr: Uint8Array): Header {
  return {
    width: readU32(ihdr, 0),
    height: readU32(ihdr, 4),
    bitDepth: ihdr[8],
    colourType: ihdr[9],
    interlace: ihdr[12],
  };
}

/** Channels per pixel for a colour type (before the bit-depth/alpha adjustment). */
function channels(colourType: number): number {
  switch (colourType) {
    case 0: return 1; // grayscale
    case 2: return 3; // RGB
    case 3: return 1; // palette index
    case 4: return 2; // gray + alpha
    case 6: return 4; // RGBA
    default: throw new Error(`png: unsupported colour type ${colourType}`);
  }
}

/** Per-pixel filter byte count, rounded up for sub-byte depths (a 1-bit image filters by byte). */
function filterBpp(bitDepth: number, colourType: number): number {
  const bits = bitDepth * channels(colourType);
  return Math.max(1, Math.ceil(bits / 8));
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse the per-scanline filters in place (PNG spec §9). */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[src + x];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp] : 0;
      let value: number;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + left; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((left + up) >> 1); break;
        case 4: value = rawByte + paeth(left, up, upLeft); break;
        default: throw new Error(`png: unknown filter type ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    src += stride;
  }
  return out;
}

/** Extract the sub-byte sample at pixel `x` from a packed scanline (depths 1/2/4). */
function sampleAt(row: Uint8Array, x: number, bitDepth: number): number {
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(x / perByte)];
  const shift = 8 - bitDepth * ((x % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/** Scale a `bitDepth`-wide grayscale sample to 0..255. */
function scaleGray(sample: number, bitDepth: number): number {
  const max = (1 << bitDepth) - 1;
  return Math.round((sample / max) * 255);
}

const luma = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/** Decode a PNG into an 8-bit luminance plane. Throws with a reason when the form is not supported. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  if (!isPng(bytes)) throw new Error('png: not a PNG (bad signature)');
  let at = 8;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (at + 8 <= bytes.length) {
    const length = readU32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = parseHeader(data);
    else if (type === 'PLTE') palette = data.slice();
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length; // length + type + data + crc
  }

  if (!header) throw new Error('png: missing IHDR');
  const { width, height, bitDepth, colourType, interlace } = header;
  if (interlace !== 0) throw new Error('png: interlaced PNG is not supported');
  if (width <= 0 || height <= 0) throw new Error('png: empty image');

  const merged = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) { merged.set(c, off); off += c.length; }
  const inflated = inflateZlib(merged);

  const bpp = filterBpp(bitDepth, colourType);
  const stride = width * bpp;
  if (inflated.length < (stride + 1) * height) throw new Error('png: image data truncated');
  const pixels = unfilter(inflated, width, height, bpp);

  const gray = new Uint8Array(width * height);
  const ch = channels(colourType);
  const bytesPerSample = bitDepth === 16 ? 2 : 1;

  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, y * stride + stride);
    for (let x = 0; x < width; x++) {
      let g: number;
      if (bitDepth < 8) {
        const s = sampleAt(row, x, bitDepth);
        g = colourType === 3
          ? (palette ? luma(palette[s * 3], palette[s * 3 + 1], palette[s * 3 + 2]) : 0)
          : scaleGray(s, bitDepth);
      } else {
        const base = x * ch * bytesPerSample;
        const pick = (i: number) => (bytesPerSample === 2 ? row[base + i * 2] : row[base + i]);
        if (colourType === 0) g = pick(0);
        else if (colourType === 2) g = luma(pick(0), pick(1), pick(2));
        else if (colourType === 3) {
          const idx = row[base];
          g = palette ? luma(palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]) : 0;
        } else if (colourType === 4) g = pick(0);
        else g = luma(pick(0), pick(1), pick(2));
      }
      gray[y * width + x] = g;
    }
  }
  return { width, height, gray };
}
