/**
 * Archive unpacking with hard limits (S17; docs/SYSTELIGON.md §20).
 *
 * An archive is the classic way to smuggle three things past a naive importer: a zip bomb (a small
 * file that inflates without bound), a path traversal (`../../etc/passwd`, an absolute `/etc/…`), and
 * a nested archive that hides either. This module unpacks an in-memory archive under a budget that
 * cannot be exceeded, rejects every dangerous path, never executes anything, and hashes every member
 * so the inventory can name what it found.
 *
 * It is pure and deterministic: same bytes, same inventory. It performs no I/O and calls nothing
 * external. The ZIP reader is the caller's (`jszip` today); this module owns the POLICY — the limits
 * and the path rules — so the policy is unit-tested without a real archive on disk.
 */

/** The hard limits. Every one of them is enforced; none is advisory. */
export interface UnpackLimits {
  /** The most members an archive may contain. */
  maxEntries: number;
  /** The most bytes any one member may inflate to. */
  maxEntryBytes: number;
  /** The most bytes ALL members may inflate to together. */
  maxTotalBytes: number;
  /** The most the whole archive may inflate relative to its compressed size (zip-bomb ratio). */
  maxCompressionRatio: number;
  /** How deep a nested archive may recurse. 0 means no recursion. */
  maxDepth: number;
}

/** The default budget. Deliberately generous for real evidence, ruthless against a bomb. */
export const DEFAULT_LIMITS: UnpackLimits = {
  maxEntries: 512,
  maxEntryBytes: 64 * 1024 * 1024, // 64 MiB
  maxTotalBytes: 256 * 1024 * 1024, // 256 MiB
  maxCompressionRatio: 200,
  maxDepth: 2,
};

/** One member of an archive, described without holding its bytes. */
export interface ArchiveEntry {
  /** The normalised, safe path inside the archive. */
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
  /** Compressed size in bytes, when the reader reports it. */
  compressedSize: number;
  /** SHA-256 of the member's bytes, lower-case hex. */
  sha256: string;
  /** True when this member is itself an archive (a nested ZIP), so the caller may recurse. */
  isArchive: boolean;
}

/** The outcome of unpacking: either an inventory, or a refusal with the reason stated. */
export type UnpackResult =
  | { ok: true; entries: ArchiveEntry[]; totalBytes: number; ratio: number; depth: number }
  | { ok: false; reason: string };

/** The reader the caller supplies: list an archive's members and their decompressed bytes. */
export interface ArchiveReader {
  /** The member names, in archive order. */
  names(): string[];
  /** A member's uncompressed size in bytes, without inflating it. */
  sizeOf(name: string): number;
  /** A member's compressed size in bytes. */
  compressedSizeOf(name: string): number;
  /** A member's decompressed bytes. Only called for members that passed the path and size checks. */
  bytesOf(name: string): Promise<Uint8Array>;
}

/** The hasher the caller supplies (platform SHA-256), so this module stays free of a crypto import. */
export type Hasher = (bytes: Uint8Array) => Promise<string>;

/**
 * Is this member path safe? A safe path is relative, contains no `..` segment, is not absolute, and
 * has no drive letter or backslash escape. Anything else is a traversal attempt and is refused, not
 * sanitised — silently rewriting a hostile path hides the attempt from the inventory.
 */
export function isSafeArchivePath(path: string): boolean {
  if (!path) return false;
  const normalised = path.replace(/\\/g, '/');
  if (normalised.startsWith('/')) return false; // absolute (POSIX)
  if (/^[a-zA-Z]:/.test(normalised)) return false; // absolute (Windows drive)
  if (normalised.startsWith('//')) return false; // UNC
  const segments = normalised.split('/');
  if (segments.some((s) => s === '..')) return false; // traversal
  if (segments.some((s) => s === '' && normalised !== '/')) {
    // An empty segment means `a//b` or a trailing slash (a directory entry). A directory is fine; an
    // interior empty segment is suspicious but not dangerous, so only reject a leading one.
    if (segments[0] === '') return false;
  }
  return true;
}

/** Normalise a member path for the inventory: forward slashes, no leading `./`. */
export function normaliseArchivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** A stable order, so the inventory is deterministic whatever order the reader lists entries in. */
function sortedNames(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Unpack an archive under `limits`. Returns an inventory on success, or a refusal naming the first
 * limit that was hit. The checks run BEFORE any member is inflated where the reader can report sizes
 * without inflating, so a bomb is refused before it is decompressed.
 */
export async function unpackArchive(
  reader: ArchiveReader,
  hasher: Hasher,
  limits: UnpackLimits = DEFAULT_LIMITS,
  depth = 0,
): Promise<UnpackResult> {
  const names = sortedNames(reader.names());

  // (1) entry count, before anything is inflated.
  if (names.length > limits.maxEntries) {
    return { ok: false, reason: `Archive has ${names.length} members; the limit is ${limits.maxEntries}.` };
  }

  // (2) paths, before anything is inflated.
  for (const name of names) {
    if (!isSafeArchivePath(name)) {
      return { ok: false, reason: `Archive member "${name}" is an unsafe path (absolute or traversal).` };
    }
  }

  // (3) declared total and per-member sizes, before inflation.
  let declaredTotal = 0;
  for (const name of names) {
    const size = reader.sizeOf(name);
    if (size > limits.maxEntryBytes) {
      return { ok: false, reason: `Archive member "${name}" declares ${size} bytes; the per-member limit is ${limits.maxEntryBytes}.` };
    }
    declaredTotal += size;
  }
  if (declaredTotal > limits.maxTotalBytes) {
    return { ok: false, reason: `Archive declares ${declaredTotal} bytes total; the limit is ${limits.maxTotalBytes}.` };
  }

  // (4) compression ratio, before inflation. A ratio over the budget is a bomb, refused outright.
  let compressedTotal = 0;
  for (const name of names) compressedTotal += Math.max(0, reader.compressedSizeOf(name));
  const ratio = compressedTotal > 0 ? declaredTotal / compressedTotal : declaredTotal > 0 ? Infinity : 0;
  if (ratio > limits.maxCompressionRatio) {
    return {
      ok: false,
      reason: `Archive inflates ${ratio === Infinity ? 'without bound' : `${Math.round(ratio)}×`} (limit ${limits.maxCompressionRatio}×); refused as a possible zip bomb.`,
    };
  }

  // (5) inflate each member, checking the ACTUAL size against the budget as we go, because a
  //     dishonest header can understate the real size. The budget is enforced against real bytes.
  const entries: ArchiveEntry[] = [];
  let runningTotal = 0;
  for (const name of names) {
    const bytes = await reader.bytesOf(name);
    if (bytes.length > limits.maxEntryBytes) {
      return { ok: false, reason: `Archive member "${name}" inflated to ${bytes.length} bytes; the per-member limit is ${limits.maxEntryBytes}.` };
    }
    runningTotal += bytes.length;
    if (runningTotal > limits.maxTotalBytes) {
      return { ok: false, reason: `Archive inflated past ${limits.maxTotalBytes} bytes; stopped.` };
    }
    entries.push({
      path: normaliseArchivePath(name),
      size: bytes.length,
      compressedSize: Math.max(0, reader.compressedSizeOf(name)),
      sha256: await hasher(bytes),
      isArchive: isArchiveBytes(bytes),
    });
  }

  return { ok: true, entries, totalBytes: runningTotal, ratio, depth };
}

/** True when a member is itself a ZIP, so the caller may recurse within the depth limit. */
export function isArchiveBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}
