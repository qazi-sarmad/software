/**
 * Byte-level inspection of the file formats this project writes: PNG and GIF (C2.7, C4).
 *
 * These are read helpers, not renderers. They exist so tests (and the tutorial gate) can assert facts
 * about a file rather than trusting that a renderer ran: a PNG's real dimensions and colour type, the
 * inflate of its pixel stream (so two renders can be compared without a lossy step), and a GIF's frame
 * count and screen size. Nothing here reads the network or the DOM.
 */

/**
 * Node's zlib, when it is available. The dynamic import of a built-in resolves to a namespace whose
 * functions sit on `default`; unwrap it. Returns null in a browser, where the stream API is used.
 */
async function loadZlib(): Promise<{ inflateSync: (b: Uint8Array) => { toString(encoding?: string): string } } | null> {
  try {
    const mod = await import('node:zlib') as unknown as { inflateSync?: unknown; default?: { inflateSync?: unknown } };
    const inflate = (mod.inflateSync ?? mod.default?.inflateSync) as ((b: Uint8Array) => { toString(encoding?: string): string }) | undefined;
    return inflate ? { inflateSync: inflate } : null;
  } catch {
    return null;
  }
}

/** A PNG's IHDR facts. */
export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  /** Byte length of the whole file. */
  bytes: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Read a PNG's IHDR. Throws a plain-language error when the file is not a PNG. */
export function pngInfo(bytes: Uint8Array): PngInfo {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG: bad signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: bytes[24],
    colourType: bytes[25],
    bytes: bytes.length,
  };
}

/** Walk the PNG chunks, returning each IDAT payload. Chunk layout: length, type, data, crc. */
function pngChunks(bytes: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Array<{ type: string; data: Uint8Array }> = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const data = bytes.subarray(at + 8, at + 8 + len);
    out.push({ type, data });
    at += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/**
 * Inflate a PNG's pixel stream (the concatenated IDAT payloads). Two renders are identical when this
 * is identical, which is how determinism is asserted without a lossless encoder round trip. Returns
 * the raw (still filter-prefixed) scanlines. Available in Node tests and in a browser worker.
 */
export async function inflatePngIdat(bytes: Uint8Array): Promise<Uint8Array> {
  const idat = pngChunks(bytes).filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (idat.length === 0) throw new Error('not a PNG: no IDAT chunk');
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const d of idat) { joined.set(d, at); at += d.length; }

  // Prefer the platform's zlib where it exists (Node), then the web stream API. `import()` of a CJS
  // built-in resolves to a namespace whose functions live on `default`, so unwrap before use.
  const zlib = await loadZlib();
  if (zlib) return new Uint8Array(zlib.inflateSync(joined) as unknown as ArrayLike<number>);
  {
    const stream = new DecompressionStream('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(joined);
    void writer.close();
    const reader = stream.readable.getReader();
    const parts: Uint8Array[] = [];
    let len = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      len += value.length;
    }
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }
}

/** A GIF's screen facts, read from the header and the image descriptors. */
export interface GifInfo {
  width: number;
  height: number;
  /** The number of image descriptors — the number of frames in the animation. */
  frames: number;
  bytes: number;
}

/**
 * Read a GIF's logical screen size and frame count. A GIF is a header, one optional global colour
 * table, then a sequence of blocks; an image descriptor (0x2C) is one frame, an extension (0x21) is
 * skipped, and 0x3B ends the file. This is the whole grammar needed to count frames honestly.
 */
export function gifInfo(bytes: Uint8Array): GifInfo {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('not a GIF: bad signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 6;
  const width = view.getUint16(at, true);
  const height = view.getUint16(at + 2, true);
  const packed = bytes[at + 4];
  at += 7;
  if (packed & 0x80) at += 3 * (1 << ((packed & 0x07) + 1)); // global colour table

  const skipSubBlocks = () => {
    while (at < bytes.length) {
      const n = bytes[at++];
      if (n === 0) break;
      at += n;
    }
  };

  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === 0x3b) break; // trailer
    if (block === 0x2c) { // image descriptor: 9 bytes then an optional local table, then LZW data
      const localPacked = bytes[at + 8];
      at += 9;
      if (localPacked & 0x80) at += 3 * (1 << ((localPacked & 0x07) + 1));
      at += 1; // LZW minimum code size
      skipSubBlocks();
      frames++;
    } else if (block === 0x21) { // extension
      at += 1; // label
      skipSubBlocks();
    } else {
      break; // unknown block: stop rather than read past the end
    }
  }
  return { width, height, frames, bytes: bytes.length };
}

/** SHA-256 of a byte array as lowercase hex, computed here so callers need no other import. */
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The visible text of a PDF produced by pdf-lib. Content streams are Flate compressed and text is
 * written as hex string operands (`<4175..> Tj`), so each stream is inflated and every hex or literal
 * string operand is decoded. Enough to prove that the words a caller put in a model are the words a
 * reader sees; not a general PDF extractor (no font subset decoding, so only single-byte encodings).
 */
export async function pdfPlainText(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes).toString('latin1');
  const parts: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const m of raw.matchAll(streamRe)) {
    const chunk = Buffer.from(m[1], 'latin1');
    const zlib = await loadZlib();
    let text: string;
    if (zlib) {
      try {
        text = zlib.inflateSync(chunk).toString('latin1');
      } catch {
        text = m[1]; // an uncompressed stream
      }
    } else {
      text = m[1];
    }
    // pdf-lib writes text as hex string operands; the bytes are a single-byte (Latin-1) string.
    for (const hex of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      parts.push(Buffer.from(hex[1], 'hex').toString('latin1'));
    }
    for (const lit of text.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
      parts.push(lit[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n'));
    }
  }
  return parts.join('\n');
}
