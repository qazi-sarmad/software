/**
 * A minimal, deterministic PNG encoder (C2.7, spec §18 "Charts and graphs: PNG, SVG, PDF").
 *
 * Charts must be exportable as PNG, but a browser canvas is not available in a test and a
 * rasterising library would add a dependency for one format. PNG's stored (uncompressed) deflate
 * form is simple and needs no zlib: every scanline is prefixed with filter type 0 and the whole
 * stream is wrapped in a zlib container whose blocks use the "stored" method. The result is
 * byte-for-byte deterministic for the same pixels, which is what the determinism test asserts.
 *
 * Only what the chart renderer needs is here: RGBA pixels in, PNG bytes out.
 */

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** Wrap bytes as a zlib stream using the stored (uncompressed) deflate method — valid and simple. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  const maxBlock = 65535;
  for (let off = 0; off < raw.length || off === 0; off += maxBlock) {
    const len = Math.min(maxBlock, raw.length - off);
    const isLast = off + len >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = isLast;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    header[3] = ~len & 0xff;
    header[4] = (~len >>> 8) & 0xff;
    parts.push(header, raw.subarray(off, off + len));
    if (raw.length === 0) break;
  }
  parts.push(u32(adler32(raw)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Encode an RGBA pixel buffer (width*height*4 bytes) as a PNG. Deterministic: no timestamp chunk is
 * written, so the same pixels always produce the same bytes.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export interface Rgba { r: number; g: number; b: number; a?: number }

/** A tiny RGBA canvas the chart renderer draws into; no DOM, no canvas element. */
export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgba) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  private set(x: number, y: number, c: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c.r & 0xff;
    this.data[i + 1] = c.g & 0xff;
    this.data[i + 2] = c.b & 0xff;
    this.data[i + 3] = c.a ?? 255;
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, c);
    }
  }

  /** A 1-pixel-wide line, Bresenham, so a chart's axes and series are exactly reproducible. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgba): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  png(): Uint8Array {
    return encodePng(this.data, this.width, this.height);
  }
}

/** Parse "#rrggbb" into components; used so the chart renderer never writes a raw hex elsewhere. */
export function parseHexColour(hex: string): Rgba {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
