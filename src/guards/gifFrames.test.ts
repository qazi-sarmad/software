import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readGif } from '../../scripts/gifInfo.mjs';

/**
 * C4: the tutorial gate must MEASURE a recording, not guess from its bytes.
 *
 * Both the gate (scripts/check-tutorials.mjs) and the C4 proof (e2e/c4-tutorial-record.spec.ts)
 * previously counted frames with a byte scan for the Graphic Control Extension introducer
 * (0x21 0xF9). Those two bytes also occur inside compressed LZW image data, so a genuine 8-frame
 * recording was read as 22 frames and the C4 spec failed on a recording that was correct. The
 * parser walks the block structure instead; these tests pin that it agrees with an independent
 * reference walk and that it over-counts nothing on the committed placeholder.
 */

/** An independent reference walk, written the other way round, for the same files. */
function referenceFrames(buf: Buffer): number {
  let i = 10;
  const packed = buf[i];
  i += 3;
  if (packed & 0x80) i += 3 * 2 ** ((packed & 7) + 1);
  let frames = 0;
  while (i < buf.length) {
    const b = buf[i++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      i++; // label
      while (buf[i] !== 0) i += 1 + buf[i];
      i++;
    } else if (b === 0x2c) {
      const lp = buf[i + 8];
      i += 9;
      if (lp & 0x80) i += 3 * 2 ** ((lp & 7) + 1);
      i++; // LZW min code size
      while (buf[i] !== 0) i += 1 + buf[i];
      i++;
      frames++;
    } else break;
  }
  return frames;
}

const placeholder = resolve(process.cwd(), 'public/tutorials/oa.features.gif');

describe('GIF frame reader (C4)', () => {
  it('reads the committed placeholder as a valid 960px GIF', () => {
    const info = readGif(readFileSync(placeholder));
    expect(info.valid).toBe(true);
    expect(info.width).toBe(960);
    expect(info.frames).toBeGreaterThan(0);
  });

  it('never over-counts: the parser agrees with an independent walk', () => {
    const buf = readFileSync(placeholder);
    expect(readGif(buf).frames).toBe(referenceFrames(buf));
  });

  it('is not a byte scan: it ignores the introducer bytes inside image data', () => {
    // A two-frame GIF whose image data CONTAINS the byte pair 0x21 0xF9 (legal inside compressed
    // LZW data). The naive scan the gate used to run counts four "frames"; the parser counts two.
    const gct = Buffer.from([0, 0, 0, 255, 255, 255]);
    const frame = () =>
      Buffer.concat([
        // Graphic control extension: introducer, label, block size 4, four data bytes, terminator.
        Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]),
        Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00]), // image descriptor
        Buffer.from([0x02]), // LZW minimum code size
        Buffer.from([0x04, 0x21, 0xf9, 0x21, 0xf9, 0x00]), // sub-block carrying the decoy pair
      ]);
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'latin1'),
      Buffer.from([1, 0, 1, 0, 0x80, 0, 0]),
      gct,
      frame(),
      frame(),
      Buffer.from([0x3b]),
    ]);

    let naive = 0;
    for (let i = 0; i < gif.length - 3; i++) if (gif[i] === 0x21 && gif[i + 1] === 0xf9) naive++;
    const info = readGif(gif);
    expect(info.valid).toBe(true);
    expect(info.frames).toBe(2);
    expect(naive).toBeGreaterThan(info.frames);
  });

  it('rejects a non-GIF', () => {
    const info = readGif(Buffer.from('not a gif at all, just text'));
    expect(info.valid).toBe(false);
    expect(info.frames).toBe(0);
  });
});
