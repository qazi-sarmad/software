/**
 * DEFLATE (RFC 1951) and zlib (RFC 1950) decoders — the decompressor the bundled OCR engine needs to
 * read a scan that arrives as a PNG. It is deliberately self-contained: the engine ships inside the
 * tenant and calls nothing, so it cannot depend on a platform zlib (a browser has none) or a network
 * service. Pure and deterministic: the same bytes always inflate to the same bytes.
 *
 * Only decompression is implemented. Every branch is checked against Node's own `zlib` in
 * `inflate.test.ts`, including dynamic-Huffman blocks, which is the only way to trust a hand-written
 * Huffman decoder.
 */

const MAX_BITS = 15;

/** A Huffman table: how many codes of each length, and the symbols in canonical order. */
interface Huffman {
  count: number[];
  symbols: number[];
}

/** Read bits LSB-first, as DEFLATE defines. */
class BitReader {
  private readonly data: Uint8Array;
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** One bit, or throw when the input is exhausted (a truncated stream must not silently succeed). */
  bit(): number {
    if (this.bitCnt === 0) {
      if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of input');
      this.bitBuf = this.data[this.pos++];
      this.bitCnt = 8;
    }
    const b = this.bitBuf & 1;
    this.bitBuf >>= 1;
    this.bitCnt -= 1;
    return b;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v |= this.bit() << i;
    return v;
  }

  /** Discard the rest of the current byte so the next read is byte-aligned (used by stored blocks). */
  align(): void {
    this.bitCnt = 0;
  }

  /** A whole byte, for a stored block's literal bytes. */
  byte(): number {
    if (this.pos >= this.data.length) throw new Error('inflate: unexpected end of input');
    return this.data[this.pos++];
  }
}

/** Build a canonical Huffman table from code lengths (puff.c's approach: simple and provably correct). */
function buildHuffman(lengths: number[]): Huffman {
  const count = new Array(MAX_BITS + 1).fill(0);
  for (const l of lengths) {
    if (l > MAX_BITS) throw new Error('inflate: code length too long');
    count[l] += 1;
  }
  count[0] = 0;
  const offs = new Array(MAX_BITS + 2).fill(0);
  for (let i = 1; i <= MAX_BITS; i++) offs[i + 1] = offs[i] + count[i];
  const symbols = new Array<number>(lengths.length).fill(0);
  for (let sym = 0; sym < lengths.length; sym++) {
    if (lengths[sym]) symbols[offs[lengths[sym]]++] = sym;
  }
  return { count, symbols };
}

function decodeSymbol(r: BitReader, h: Huffman): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= MAX_BITS; len++) {
    code |= r.bit();
    const count = h.count[len];
    if (code - first < count) return h.symbols[index + (code - first)];
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  throw new Error('inflate: invalid Huffman code');
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A growable output buffer. */
class Output {
  buf = new Uint8Array(1 << 16);
  len = 0;

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  push(byte: number): void {
    this.ensure(1);
    this.buf[this.len++] = byte;
  }

  /** Copy a length/distance pair from already-decoded output (a back-reference). */
  copy(dist: number, length: number): void {
    if (dist > this.len) throw new Error('inflate: distance too far back');
    this.ensure(length);
    let from = this.len - dist;
    for (let i = 0; i < length; i++) this.buf[this.len++] = this.buf[from++];
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

function fixedTables(): { lit: Huffman; dist: Huffman } {
  const litLen = new Array<number>(288);
  for (let i = 0; i < 144; i++) litLen[i] = 8;
  for (let i = 144; i < 256; i++) litLen[i] = 9;
  for (let i = 256; i < 280; i++) litLen[i] = 7;
  for (let i = 280; i < 288; i++) litLen[i] = 8;
  const distLen = new Array<number>(30).fill(5);
  return { lit: buildHuffman(litLen), dist: buildHuffman(distLen) };
}

function dynamicTables(r: BitReader): { lit: Huffman; dist: Huffman } {
  const hlit = r.bits(5) + 257;
  const hdist = r.bits(5) + 1;
  const hclen = r.bits(4) + 4;
  const clenLen = new Array<number>(19).fill(0);
  for (let i = 0; i < hclen; i++) clenLen[CLEN_ORDER[i]] = r.bits(3);
  const clen = buildHuffman(clenLen);

  const lengths: number[] = [];
  while (lengths.length < hlit + hdist) {
    const sym = decodeSymbol(r, clen);
    if (sym < 16) lengths.push(sym);
    else if (sym === 16) {
      if (lengths.length === 0) throw new Error('inflate: repeat with no previous length');
      const prev = lengths[lengths.length - 1];
      const repeat = 3 + r.bits(2);
      for (let i = 0; i < repeat; i++) lengths.push(prev);
    } else if (sym === 17) {
      const repeat = 3 + r.bits(3);
      for (let i = 0; i < repeat; i++) lengths.push(0);
    } else {
      const repeat = 11 + r.bits(7);
      for (let i = 0; i < repeat; i++) lengths.push(0);
    }
  }
  const lit = buildHuffman(lengths.slice(0, hlit));
  const dist = buildHuffman(lengths.slice(hlit));
  return { lit, dist };
}

function inflateBlockBody(r: BitReader, out: Output, lit: Huffman, dist: Huffman): void {
  for (;;) {
    const sym = decodeSymbol(r, lit);
    if (sym < 256) {
      out.push(sym);
    } else if (sym === 256) {
      return; // end of block
    } else {
      const li = sym - 257;
      if (li >= LENGTH_BASE.length) throw new Error('inflate: invalid length code');
      const length = LENGTH_BASE[li] + r.bits(LENGTH_EXTRA[li]);
      const dsym = decodeSymbol(r, dist);
      if (dsym >= DIST_BASE.length) throw new Error('inflate: invalid distance code');
      const distance = DIST_BASE[dsym] + r.bits(DIST_EXTRA[dsym]);
      out.copy(distance, length);
    }
  }
}

/** Decompress a raw DEFLATE stream (no zlib wrapper). */
export function inflateRaw(data: Uint8Array): Uint8Array {
  const r = new BitReader(data);
  const out = new Output();
  let last = 0;
  do {
    last = r.bit();
    const type = r.bits(2);
    if (type === 0) {
      r.align();
      const len = r.byte() | (r.byte() << 8);
      const nlen = r.byte() | (r.byte() << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: stored block length mismatch');
      for (let i = 0; i < len; i++) out.push(r.byte());
    } else if (type === 1) {
      const { lit, dist } = fixedTables();
      inflateBlockBody(r, out, lit, dist);
    } else if (type === 2) {
      const { lit, dist } = dynamicTables(r);
      inflateBlockBody(r, out, lit, dist);
    } else {
      throw new Error('inflate: invalid block type 3');
    }
  } while (!last);
  return out.result();
}

/** Decompress a zlib stream (RFC 1950): a 2-byte header, a DEFLATE stream, a 4-byte Adler-32. */
export function inflateZlib(data: Uint8Array): Uint8Array {
  if (data.length < 2) throw new Error('inflate: zlib stream too short');
  const cmf = data[0];
  const flg = data[1];
  if ((cmf & 0x0f) !== 8) throw new Error('inflate: unsupported compression method');
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error('inflate: bad zlib header check');
  const out = inflateRaw(data.subarray(2));
  return out;
}
