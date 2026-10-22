/**
 * Minimal GIF reader for the tutorial gate (C4).
 *
 * The frame count, width and byte size of a recording must be measured, not guessed. A byte scan for
 * the Graphic Control Extension introducer (0x21 0xF9) or the image-descriptor byte (0x2C) also
 * matches those byte pairs inside compressed LZW image data, so it over-counts frames on a real
 * recording (a 8-frame GIF read as 22 frames). This walks the block structure instead: header,
 * logical screen descriptor, global colour table, then each extension/image-descriptor/trailer block,
 * skipping every sub-block chain exactly as the format defines it. A frame is one image descriptor.
 */

import fs from 'node:fs';

const SIGNATURES = ['GIF87a', 'GIF89a'];

/** Skip a chain of sub-blocks: [size][size bytes]... terminated by a 0x00 size byte. */
function skipSubBlocks(buf, i) {
  while (i < buf.length) {
    const size = buf[i];
    i += 1;
    if (size === 0) return i;
    i += size;
  }
  return i;
}

/** Skip a colour table of 3 * 2^(bits+1) bytes. */
function skipColorTable(buf, i, packed) {
  if (!(packed & 0x80)) return i;
  return i + 3 * 2 ** ((packed & 7) + 1);
}

/**
 * Read a GIF's structure. Returns {width, height, frames, bytes, valid}.
 * `frames` is the number of image descriptors (the animation frames). A malformed file returns
 * valid: false with whatever was read, so a caller fails on `valid` rather than on a stale count.
 */
export function readGif(buf) {
  const sig = buf.subarray(0, 6).toString('latin1');
  if (!SIGNATURES.includes(sig)) return { width: 0, height: 0, frames: 0, bytes: buf.length, valid: false };

  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  let i = 10;
  const screenPacked = buf[i];
  i += 3; // packed, background colour index, pixel aspect ratio
  i = skipColorTable(buf, i, screenPacked);

  let frames = 0;
  while (i < buf.length) {
    const block = buf[i];
    i += 1;
    if (block === 0x3b) return { width, height, frames, bytes: buf.length, valid: true }; // trailer
    if (block === 0x21) {
      // Extension: label byte, then sub-blocks (a Graphic Control Extension is 4 fixed bytes).
      i += 1;
      i = skipSubBlocks(buf, i);
      continue;
    }
    if (block === 0x2c) {
      // Image descriptor body: left(2) top(2) width(2) height(2) packed(1). The packed byte is the
      // ninth, and its high bit says a local colour table follows.
      const localPacked = buf[i + 8];
      i += 9;
      i = skipColorTable(buf, i, localPacked);
      i += 1; // LZW minimum code size
      i = skipSubBlocks(buf, i);
      frames += 1;
      continue;
    }
    // An unknown block byte means the walk lost the structure: report what was counted.
    return { width, height, frames, bytes: buf.length, valid: false };
  }
  return { width, height, frames, bytes: buf.length, valid: false };
}

export function readGifFile(file) {
  return readGif(fs.readFileSync(file));
}
