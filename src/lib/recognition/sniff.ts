/**
 * Magic-byte recognition (S17; docs/SYSTELIGON.md §20, `docs/SPEC-v10.md`).
 *
 * The extension is a claim the file makes about itself. A `.csv` that is really a ZIP, or a `.pdf`
 * that is really a PNG, must be recognised for what it IS, not for what it is named — otherwise the
 * importer hands the wrong parser a stream it cannot read, and a mislabelled archive slips past a
 * check that only looks at the name. This module reads the first bytes and returns the truth.
 *
 * It is pure: a function of the byte prefix and, where the format needs it, a small probe callback
 * the caller supplies to look deeper (the ZIP central directory, an OOXML part list). No clock, no
 * client, no tenant read. Nothing here executes a file or follows a path out of it.
 */

/** The format families the importer understands, plus the ones it must name as unrecognised. */
export type RecognisedKind =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'zip'
  | 'pdf'
  | 'csv'
  | 'png'
  | 'gif'
  | 'jpeg'
  | 'tiff'
  | 'doc'
  | 'xls'
  | 'ppt'
  | 'rar'
  | '7z'
  | 'gzip'
  | 'text'
  | 'unknown';

/** A byte signature: the offset, the bytes expected there, and an optional mask for the compared bytes. */
interface Signature {
  kind: RecognisedKind;
  offset: number;
  bytes: number[];
  /** When present, only the bits set here are compared (for `??`-style nibble wildcards). */
  mask?: number[];
}

/**
 * Signatures, longest/most-specific first so `%PDF` beats a generic text heuristic. ZIP is listed as
 * `zip` here; the caller reclassifies an office document by probing the archive's entries (see
 * `classifyOfficeArchive`), because OOXML is a ZIP whose entries say which application wrote it.
 */
const SIGNATURES: Signature[] = [
  { kind: 'pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { kind: 'png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { kind: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  { kind: 'gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { kind: 'jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { kind: 'tiff', offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, // little-endian
  { kind: 'tiff', offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // big-endian
  { kind: 'rar', offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] }, // Rar!\x1a\x07 (v4/v5 share the stem)
  { kind: '7z', offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  { kind: 'gzip', offset: 0, bytes: [0x1f, 0x8b] },
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // local file header
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive (EOCD)
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08] }, // spanned archive
  // Legacy OLE2 compound file (the container .doc/.xls/.ppt share). The D0 CF 11 E0 A1 B1 1A E1 stem
  // is exact; the kind is decided by probing the compound directory in the caller.
  { kind: 'doc', offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
];

/** The OLE2 compound-file signature, whatever application wrote it. */
export const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function matches(bytes: Uint8Array, sig: Signature): boolean {
  if (bytes.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    const at = sig.offset + i;
    const mask = sig.mask?.[i] ?? 0xff;
    if ((bytes[at] & mask) !== (sig.bytes[i] & mask)) return false;
  }
  return true;
}

/**
 * The raw byte signature of a file: the format its first bytes declare. OOXML and OLE2 return their
 * container (`zip`, `doc`) — `sniffKind` resolves them further when it can probe the container.
 */
export function sniffKind(bytes: Uint8Array): RecognisedKind {
  for (const sig of SIGNATURES) if (matches(bytes, sig)) return sig.kind;
  return 'unknown';
}

/** True when the byte prefix is an OLE2 compound file (the legacy .doc/.xls/.ppt container). */
export function isOle2(bytes: Uint8Array): boolean {
  return matches(bytes, { kind: 'doc', offset: 0, bytes: OLE2_SIGNATURE });
}

/**
 * A printable-text probe: the bytes are text when every byte is a legal UTF-8/ASCII unit and there is
 * no NUL in the sampled prefix. This is deliberately conservative — a binary blob with one stray
 * printable run must NOT be called text.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let printable = 0;
  for (const b of sample) {
    if (b === 0x00) return false; // NUL: not text
    if (b === 0x09 || b === 0x0a || b === 0x0d) printable++;
    else if (b >= 0x20) printable++;
  }
  // Require the overwhelming majority to be printable, so a binary header with a few ASCII letters
  // is not misread as text.
  return printable / sample.length > 0.95;
}

/** The extension (lower-cased, with the dot), or an empty string when there is none. */
export function extensionOf(filename: string): string {
  const at = filename.lastIndexOf('.');
  return at < 0 ? '' : filename.slice(at).toLowerCase();
}

/**
 * The OOXML entry names that decide which office application wrote a ZIP. The first content type or
 * part that matches wins; the order is the order of specificity.
 */
const OOXML_ENTRIES: Array<{ kind: RecognisedKind; entry: string }> = [
  { kind: 'docx', entry: 'word/document.xml' },
  { kind: 'xlsx', entry: 'xl/workbook.xml' },
  { kind: 'pptx', entry: 'ppt/presentation.xml' },
];

/**
 * Reclassify a ZIP by its entry names. OOXML is a ZIP, so the only honest way to tell a `.docx` from
 * a plain archive — or from a `.pptx` renamed to `.docx` — is to read the entries, not the name.
 * Returns `zip` when it is a genuine archive and none of the office parts are present.
 */
export function classifyOfficeArchive(entryNames: string[]): RecognisedKind {
  const set = new Set(entryNames.map((n) => n.replace(/^\//, '').toLowerCase()));
  for (const { kind, entry } of OOXML_ENTRIES) if (set.has(entry)) return kind;
  return 'zip';
}

/**
 * The OLE2 sub-kind: read the compound directory's stream names and pick the application. `.doc`,
 * `.xls` and `.ppt` share one container signature, so the name inside is the only distinguisher.
 */
export function classifyOle2(streamNames: string[]): 'doc' | 'xls' | 'ppt' | 'unknown' {
  const joined = streamNames.join(' ').toLowerCase();
  if (joined.includes('worddocument')) return 'doc';
  if (joined.includes('workbook') || joined.includes('book')) return 'xls';
  if (joined.includes('powerpoint')) return 'ppt';
  return 'unknown';
}

/**
 * The full recognition: what the file IS, and whether the name agreed. `probe` is the caller's way to
 * look inside a container it cannot read from the prefix alone (a ZIP's entry list, an OLE2 stream
 * list); when it is absent, a ZIP stays `zip` and an OLE2 file keeps its container kind.
 */
export interface Recognition {
  /** The format the bytes declare. */
  kind: RecognisedKind;
  /** The format the filename claimed, from its extension. */
  claimed: RecognisedKind;
  /** True when the bytes and the name agree, or the name is silent and the bytes are known. */
  agrees: boolean;
  /** A one-line, plain-language statement of what was found — never a guess dressed as a fact. */
  detail: string;
}

/** Map a file extension to the kind it claims. Unknown extensions claim `unknown`. */
export function kindFromExtension(filename: string): RecognisedKind {
  switch (extensionOf(filename)) {
    case '.docx': return 'docx';
    case '.xlsx': case '.xlsm': return 'xlsx';
    case '.pptx': return 'pptx';
    case '.zip': return 'zip';
    case '.pdf': return 'pdf';
    case '.csv': return 'csv';
    case '.tsv': case '.txt': return 'text';
    case '.png': return 'png';
    case '.gif': return 'gif';
    case '.jpg': case '.jpeg': return 'jpeg';
    case '.tif': case '.tiff': return 'tiff';
    case '.doc': return 'doc';
    case '.xls': return 'xls';
    case '.ppt': return 'ppt';
    case '.rar': return 'rar';
    case '.7z': return '7z';
    case '.gz': return 'gzip';
    default: return 'unknown';
  }
}

export interface SniffOptions {
  /** Read a ZIP's entry names. Omitted in a pure-prefix context; supplied by the importer. */
  zipEntries?: string[];
  /** Read an OLE2 file's stream names. */
  ole2Streams?: string[];
}

/**
 * Sniff a file: the byte signature first, the container probe second, and a conservative text probe
 * last. This is the function the importer calls; it never trusts the extension for the verdict, and
 * `agrees` records whether the extension was honest.
 */
export function sniffKindDeep(bytes: Uint8Array, options: SniffOptions = {}): RecognisedKind {
  const raw = sniffKind(bytes);
  if (raw === 'zip') {
    if (options.zipEntries) return classifyOfficeArchive(options.zipEntries);
    return 'zip';
  }
  if (raw === 'doc') {
    // The OLE2 container. Resolve to .doc/.xls/.ppt from the stream names when they are available.
    if (options.ole2Streams) {
      const sub = classifyOle2(options.ole2Streams);
      if (sub !== 'unknown') return sub;
    }
    return 'doc';
  }
  if (raw !== 'unknown') return raw;
  // No signature matched. A CSV is a text file whose first row is delimited; a plain text file is
  // text. Only claim `csv` when the delimiter is actually present, never on the extension alone.
  if (looksLikeText(bytes)) {
    return looksLikeCsv(bytes) ? 'csv' : 'text';
  }
  return 'unknown';
}

/** A conservative CSV probe: a first line with at least one delimiter and more than one field. */
export function looksLikeCsv(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  const text = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine) return false;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  return Math.max(commas, semis, tabs) >= 1 && firstLine.length >= 3;
}

/**
 * Recognise a file end to end and describe it honestly. `probe` is the caller's container reader.
 */
export function recognise(filename: string, bytes: Uint8Array, options: SniffOptions = {}): Recognition {
  const claimed = kindFromExtension(filename);
  const kind = sniffKindDeep(bytes, options);
  // A claim of `text` is satisfied by a `csv` verdict and vice versa (both are text); everything else
  // must match exactly. An unknown claim never disagrees — the name said nothing.
  const agrees =
    claimed === 'unknown' ||
    kind === claimed ||
    (claimed === 'csv' && kind === 'text') ||
    (claimed === 'text' && kind === 'csv');
  const detail = agrees
    ? `Recognised as ${kind}.`
    : `The name says ${claimed} but the bytes are ${kind}.`;
  return { kind, claimed, agrees, detail };
}
