/**
 * Document recognition — the inventory a user confirms before import (S17; docs/SYSTELIGON.md §20).
 *
 * Routing today is by EXTENSION only (`classify()` in `docExtractHandler.ts`, `isSpreadsheet`,
 * `isDocx`). This module is the honest replacement: it sniffs the bytes, resolves an OOXML archive to
 * the application that wrote it by reading the archive's entries, unpacks a genuine archive under a
 * hard budget, reads the metadata each format carries, and returns an INVENTORY. The user confirms the
 * inventory before anything is imported, and a file it cannot recognise is reported AS unrecognised —
 * never silently dropped and never guessed at.
 *
 * It is pure and deterministic given the bytes. It performs no network I/O and executes nothing.
 *
 * On RAR: the decompressor is licence-restricted and no library is installed. Rather than reflex-
 * install one, a `.rar` is RECOGNISED (its magic bytes are exact) and reported as an archive whose
 * members cannot be unpacked in-product, with the reason stated. Recognition is not the same as
 * unpacking, and the inventory says which one it did.
 */
import { PRODUCT_NAME } from '../product';
import { sniffKindDeep, kindFromExtension, recognise, type RecognisedKind, type Recognition } from './sniff';
import { unpackArchive, DEFAULT_LIMITS, type ArchiveEntry, type UnpackLimits } from './archive';
import { zipReader } from './zipReader';
import { parseCoreXml, parseAppXml, parsePdfInfo, mergeMetadata, type DocumentMetadata } from './metadata';

export { DEFAULT_LIMITS } from './archive';
export type { ArchiveEntry, UnpackLimits } from './archive';
export type { DocumentMetadata } from './metadata';
export type { RecognisedKind, Recognition } from './sniff';

/** One file's line in the inventory: what it is, whether the name agreed, and what is inside it. */
export interface InventoryItem {
  /** The name as supplied by the user. */
  filename: string;
  /** The format the bytes declare. */
  kind: RecognisedKind;
  /** Whether the bytes and the extension agreed, and a plain-language detail line. */
  recognition: Recognition;
  /** The file's SHA-256, lower-case hex. */
  sha256: string;
  /** The file's byte length. */
  byteSize: number;
  /** Metadata read from the file's own metadata parts, when the format carries them. */
  metadata: DocumentMetadata;
  /** For an archive (including an office document, which is a ZIP): its members, or the refusal. */
  archive?: { entries: ArchiveEntry[]; totalBytes: number; ratio: number };
  /** When the file could not be inspected, why — stated, never hidden. */
  note?: string;
}

/** The inventory the user confirms before import. */
export interface Inventory {
  items: InventoryItem[];
  /** The kinds the importer can proceed with without the user re-classifying anything. */
  importable: number;
  /** The kinds the importer cannot handle: reported, not dropped. */
  unrecognised: number;
  /** The archives that were refused (a bomb or an unsafe path), with the reason. */
  refused: number;
}

/** The SHA-256 hasher. The caller passes the platform primitive so this module needs no crypto import. */
export type Sha256 = (bytes: Uint8Array) => Promise<string>;

/** Kinds the importer can parse directly. `zip`/`rar`/`7z` are archives, handled by the unpack path. */
const IMPORTABLE: ReadonlySet<RecognisedKind> = new Set([
  'docx', 'xlsx', 'pptx', 'pdf', 'csv', 'text', 'png', 'gif', 'jpeg', 'tiff', 'doc', 'xls', 'ppt',
]);

/** Kinds that are archives: recognised, and either unpacked (zip) or reported as not unpackable. */
const ARCHIVE_KINDS: ReadonlySet<RecognisedKind> = new Set(['zip', 'rar', '7z', 'gzip']);

/**
 * Inspect one file and return its inventory line. The bytes are sniffed first; an OOXML document is
 * opened as the archive it is, both to classify it by entry name and to read its metadata.
 */
export async function inspectFile(
  filename: string,
  bytes: Uint8Array,
  sha256: Sha256,
  limits: UnpackLimits = DEFAULT_LIMITS,
): Promise<InventoryItem> {
  const hash = await sha256(bytes);
  const base = { filename, sha256: hash, byteSize: bytes.length };

  // The raw signature first, to know whether to open the file as a container.
  const raw = sniffKindDeep(bytes);

  if (raw === 'zip') {
    // Read the entries. This both classifies OOXML and lists a genuine archive's members.
    const reader = await zipReader(bytes);
    const entries = reader.names();
    const kind = sniffKindDeep(bytes, { zipEntries: entries });
    const recognition = recognise(filename, bytes, { zipEntries: entries });

    // An office document is a ZIP; its metadata parts are inside.
    let metadata: DocumentMetadata = {};
    if (kind === 'docx' || kind === 'xlsx' || kind === 'pptx') {
      metadata = await readOfficeMetadata(reader);
    }

    const unpacked = await unpackArchive(reader, sha256, limits);
    const disagreement =
      !recognition.agrees && recognition.claimed !== 'unknown'
        ? `The extension says ${recognition.claimed} but the bytes are ${kind}.`
        : undefined;
    if (!unpacked.ok) {
      return { ...base, kind, recognition, metadata, note: `Refused: ${unpacked.reason}` };
    }
    return {
      ...base,
      kind,
      recognition,
      metadata,
      ...(disagreement ? { note: disagreement } : {}),
      archive: { entries: unpacked.entries, totalBytes: unpacked.totalBytes, ratio: unpacked.ratio },
    };
  }

  if (raw === 'rar' || raw === '7z' || raw === 'gzip') {
    const recognition = recognise(filename, bytes);
    return {
      ...base,
      kind: raw,
      recognition,
      metadata: {},
      note:
        raw === 'rar'
          ? 'Recognised as a RAR archive. RAR decompression is licence-restricted and no library is bundled, so its members cannot be listed in-product; extract it outside ${PRODUCT_NAME} and import the members.'
          : `Recognised as a ${raw} archive. This build unpacks ZIP archives only; extract it outside ${PRODUCT_NAME} and import the members.`,
    };
  }

  if (raw === 'pdf') {
    const recognition = recognise(filename, bytes);
    return { ...base, kind: 'pdf', recognition, metadata: parsePdfInfo(bytes) };
  }

  // Everything else: the bytes decide, the name is only recorded as a claim.
  const recognition = recognise(filename, bytes);
  const note =
    !recognition.agrees && recognition.claimed !== 'unknown'
      ? `The extension says ${kindFromExtension(filename)} but the bytes are ${recognition.kind}.`
      : undefined;
  return { ...base, kind: recognition.kind, recognition, metadata: {}, note };
}

/**
 * A light recognition for a surface that only needs to know whether the bytes and the name agree,
 * without building the full inventory (the import wizard, which then parses the file itself).
 */
export function recogniseBytes(filename: string, bytes: Uint8Array): Recognition {
  return recognise(filename, bytes);
}

/** The format the bytes declare, resolving an OOXML ZIP by its entries where jszip can read them. */
export async function sniffBytes(filename: string, bytes: Uint8Array): Promise<RecognisedKind> {
  const raw = sniffKindDeep(bytes);
  if (raw === 'zip') {
    try {
      const reader = await zipReader(bytes);
      return sniffKindDeep(bytes, { zipEntries: reader.names() });
    } catch {
      return 'zip';
    }
  }
  return raw;
}

/** Read `docProps/core.xml` and `docProps/app.xml` from an OOXML archive. */
async function readOfficeMetadata(reader: { bytesOf(name: string): Promise<Uint8Array> }): Promise<DocumentMetadata> {
  const decode = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(b);
  try {
    const core = decode(await reader.bytesOf('docProps/core.xml'));
    const app = decode(await reader.bytesOf('docProps/app.xml'));
    return mergeMetadata(parseCoreXml(core), parseAppXml(app));
  } catch {
    // A document with no docProps parts is valid; it simply has no metadata to read.
    return {};
  }
}

/**
 * Inspect a set of files and return the inventory. Order is preserved (the user's order), so the
 * inventory reads the way the upload did.
 */
export async function buildInventory(
  files: Array<{ filename: string; bytes: Uint8Array }>,
  sha256: Sha256,
  limits: UnpackLimits = DEFAULT_LIMITS,
): Promise<Inventory> {
  const items: InventoryItem[] = [];
  for (const f of files) items.push(await inspectFile(f.filename, f.bytes, sha256, limits));
  return {
    items,
    importable: items.filter((i) => IMPORTABLE.has(i.kind)).length,
    unrecognised: items.filter((i) => !IMPORTABLE.has(i.kind) && !ARCHIVE_KINDS.has(i.kind)).length,
    refused: items.filter((i) => i.note?.startsWith('Refused:')).length,
  };
}
