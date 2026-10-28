/**
 * A ZIP reader for the unpack policy (S17; docs/SYSTELIGON.md §20).
 *
 * `jszip` is already the project's ZIP reader (it builds OOXML in `src/lib/render/`), so the unpack
 * policy in `archive.ts` is fed by an adapter over it rather than a second ZIP implementation. The
 * adapter reports sizes WITHOUT inflating where jszip can, so the bomb checks in `unpackArchive` run
 * before any member is decompressed.
 */
import JSZip from 'jszip';
import type { ArchiveReader } from './archive';

/**
 * Build an `ArchiveReader` over an in-memory ZIP. `compressedSizeOf` reads jszip's internal
 * compressed size where it is known and falls back to the uncompressed size (ratio 1) otherwise,
 * which is conservative: an unknown compressed size never makes a file look MORE compressible.
 */
export async function zipReader(bytes: Uint8Array): Promise<ArchiveReader> {
  const zip = await JSZip.loadAsync(bytes);
  const files = zip.files;
  const names = Object.keys(files).filter((n) => !files[n].dir);
  return {
    names: () => names,
    sizeOf: (name) => {
      const f = files[name];
      if (!f) return 0;
      const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      return typeof size === 'number' ? size : 0;
    },
    compressedSizeOf: (name) => {
      const f = files[name];
      if (!f) return 0;
      const data = (f as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data;
      if (data && typeof data.compressedSize === 'number') return data.compressedSize;
      // Unknown: report the uncompressed size, i.e. assume no compression, so the ratio check stays
      // conservative and cannot be gamed by a reader that hides the compressed size.
      return data && typeof data.uncompressedSize === 'number' ? data.uncompressedSize : 0;
    },
    bytesOf: async (name) => {
      const f = files[name];
      if (!f) return new Uint8Array();
      return f.async('uint8array');
    },
  };
}
