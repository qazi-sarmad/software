import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  isArchiveBytes,
  isSafeArchivePath,
  normaliseArchivePath,
  unpackArchive,
  type ArchiveReader,
  type Hasher,
  type UnpackLimits,
} from './archive';

/** A fake reader: the policy is tested without a real archive on disk. */
function reader(files: Record<string, Uint8Array>, compressed?: Record<string, number>): ArchiveReader {
  return {
    names: () => Object.keys(files),
    sizeOf: (n) => files[n]?.length ?? 0,
    compressedSizeOf: (n) => compressed?.[n] ?? files[n]?.length ?? 0,
    bytesOf: async (n) => files[n] ?? new Uint8Array(),
  };
}

const hasher: Hasher = async (b) => `h${b.length}`;

const limits = (over: Partial<UnpackLimits> = {}): UnpackLimits => ({ ...DEFAULT_LIMITS, ...over });

describe('archive path safety (S17)', () => {
  it('accepts a relative, forward-slash path', () => {
    expect(isSafeArchivePath('a/b/c.txt')).toBe(true);
    expect(isSafeArchivePath('file.txt')).toBe(true);
    expect(isSafeArchivePath('./a/b.txt')).toBe(true);
  });

  it('rejects an absolute POSIX path', () => {
    expect(isSafeArchivePath('/etc/passwd')).toBe(false);
  });

  it('rejects a Windows drive and a UNC path', () => {
    expect(isSafeArchivePath('C:/Windows/system32')).toBe(false);
    expect(isSafeArchivePath('//server/share')).toBe(false);
  });

  it('rejects a traversal segment', () => {
    expect(isSafeArchivePath('../../etc/passwd')).toBe(false);
    expect(isSafeArchivePath('a/../../b')).toBe(false);
    expect(isSafeArchivePath('a/..\\b')).toBe(false);
  });

  it('normalises a path for the inventory', () => {
    expect(normaliseArchivePath('./a\\b.txt')).toBe('a/b.txt');
  });

  it('detects a nested archive by its signature', () => {
    expect(isArchiveBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isArchiveBytes(new Uint8Array([0x50, 0x4b]))).toBe(false);
    expect(isArchiveBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false);
  });
});

describe('archive unpacking limits (S17)', () => {
  it('unpacks a small, safe archive and hashes every member', async () => {
    const r = reader({ 'a.txt': new Uint8Array([1, 2, 3]), 'b.txt': new Uint8Array([4]) });
    const out = await unpackArchive(r, hasher);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.entries.map((e) => e.path)).toEqual(['a.txt', 'b.txt']);
    expect(out.entries[0].sha256).toBe('h3');
    expect(out.totalBytes).toBe(4);
  });

  it('refuses an archive with too many members', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = new Uint8Array([i]);
    const out = await unpackArchive(reader(files), hasher, limits({ maxEntries: 5 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/10 members; the limit is 5/);
  });

  it('refuses a member that declares more than the per-member limit, before inflating it', async () => {
    const r = reader({ 'big.bin': new Uint8Array(1000) });
    const out = await unpackArchive(r, hasher, limits({ maxEntryBytes: 10 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/per-member limit is 10/);
  });

  it('refuses an archive that declares more than the total limit', async () => {
    const r = reader({ 'a.bin': new Uint8Array(50), 'b.bin': new Uint8Array(50) });
    const out = await unpackArchive(r, hasher, limits({ maxTotalBytes: 60, maxEntryBytes: 100 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/100 bytes total/);
  });

  it('refuses a zip bomb by compression ratio, before inflating it', async () => {
    // 1000 declared bytes from 1 compressed byte = ratio 1000.
    const r = reader({ 'bomb.bin': new Uint8Array(1000) }, { 'bomb.bin': 1 });
    const out = await unpackArchive(r, hasher, limits({ maxCompressionRatio: 50, maxTotalBytes: 100000 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/zip bomb/);
  });

  it('refuses an unsafe member path', async () => {
    const r = reader({ '../../etc/passwd': new Uint8Array([1]) });
    const out = await unpackArchive(r, hasher);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/unsafe path/);
  });

  it('enforces the budget against the ACTUAL inflated size, not the declared size', async () => {
    // The reader lies: it declares 1 byte but returns 100. The real bytes must trip the budget.
    const r: ArchiveReader = {
      names: () => ['liar.bin'],
      sizeOf: () => 1,
      compressedSizeOf: () => 1,
      bytesOf: async () => new Uint8Array(100),
    };
    const out = await unpackArchive(r, hasher, limits({ maxEntryBytes: 50 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toMatch(/inflated to 100 bytes/);
  });

  it('is deterministic: the same archive yields the same inventory order', async () => {
    const r = reader({ 'z.txt': new Uint8Array([1]), 'a.txt': new Uint8Array([2]) });
    const one = await unpackArchive(r, hasher);
    const two = await unpackArchive(r, hasher);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
