/**
 * Document metadata extraction (S17; docs/SYSTELIGON.md §20).
 *
 * A document carries a small, structured description of itself: who wrote it, when it was created and
 * last modified, and the application that produced it. That description is useful evidence — it dates
 * a file and names its author — and it is read here from the format's own metadata parts, never
 * inferred.
 *
 * Parsing is deliberately hand-rolled and shallow: a tag extractor over a bounded string, with no
 * entity expansion and no execution. This is not a general XML parser and must not become one — a
 * document is untrusted input, and a general parser fed untrusted XML is a liability the product does
 * not need for four fields.
 */

/** The metadata this module can read, all optional because a file may omit any of them. */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  /** ISO 8601 when the format stores it so; otherwise the raw string the format carries. */
  created?: string;
  modified?: string;
  /** The producing application, from OOXML `app.xml` (`Application`) where present. */
  application?: string;
  /** The company the producing application recorded, from `app.xml`. */
  company?: string;
}

/** XML entity decode for the five predefined entities. No numeric or external entities, ever. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The text of the first `<name>` element (with or without a namespace prefix), or undefined. Bounded
 * by the input length; there is no recursion and no entity expansion beyond the five predefined ones.
 */
export function firstTagText(xml: string, name: string): string | undefined {
  // Match `<prefix:name ...>…</prefix:name>` or `<name ...>…</name>`, non-greedy and single-line-safe.
  const re = new RegExp(`<([a-zA-Z0-9]+:)?${name}(\\s[^>]*)?>([\\s\\S]*?)</([a-zA-Z0-9]+:)?${name}>`, 'i');
  const m = xml.match(re);
  if (!m) return undefined;
  const text = decodeEntities(m[3]).trim();
  return text || undefined;
}

/**
 * Parse OOXML `docProps/core.xml` (Dublin Core): title, creator, created and modified timestamps.
 * The tags are the ones ECMA-376 defines; anything else is ignored rather than guessed at.
 */
export function parseCoreXml(xml: string): DocumentMetadata {
  return {
    title: firstTagText(xml, 'title'),
    author: firstTagText(xml, 'creator') ?? firstTagText(xml, 'lastModifiedBy'),
    created: firstTagText(xml, 'created'),
    modified: firstTagText(xml, 'modified'),
  };
}

/** Parse OOXML `docProps/app.xml` (extended properties): the producing application and company. */
export function parseAppXml(xml: string): DocumentMetadata {
  return {
    application: firstTagText(xml, 'Application'),
    company: firstTagText(xml, 'Company'),
  };
}

/**
 * Parse a PDF `/Info` dictionary. A PDF's metadata lives in the trailer's `/Info` object as a set of
 * `/Key (value)` pairs; this reads the four that matter. Values may be literal strings or hex strings
 * (`<48656c6c6f>`); both are decoded. Nothing here follows an indirect reference — an unresolvable
 * value is simply absent, which is honest.
 */
export function parsePdfInfo(bytes: Uint8Array): DocumentMetadata {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 512 * 1024)));
  const infoAt = text.lastIndexOf('/Info');
  // The /Info dictionary may be inline (`/Info << … >>`) or an indirect reference. Handle the inline
  // form and the common `/Info N 0 R` form by scanning the whole tail for the keys when needed.
  const scope = infoAt >= 0 ? text.slice(infoAt, infoAt + 8192) : text;

  const literal = (key: string): string | undefined => {
    const m = scope.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^()\\\\])*)\\)`));
    if (!m) return undefined;
    return m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\([()\\])/g, '$1')
      .trim() || undefined;
  };
  const hex = (key: string): string | undefined => {
    const m = scope.match(new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`));
    if (!m) return undefined;
    const clean = m[1].replace(/\s/g, '');
    if (clean.length % 2 !== 0 || /[^0-9A-Fa-f]/.test(clean)) return undefined;
    let out = '';
    for (let i = 0; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    // Hex strings in a PDF text field are often UTF-16BE with a BOM; strip a leading BOM if present.
    return out.replace(/^\uFEFF/, '').replace(/\u0000/g, '').trim() || undefined;
  };

  // PDF dates are `D:YYYYMMDDHHmmSS…`; normalise to ISO 8601 where the shape matches.
  const toIso = (v?: string): string | undefined => {
    if (!v) return undefined;
    const m = v.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
    if (!m) return v;
    const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  };

  return {
    title: hex('Title') ?? literal('Title'),
    author: hex('Author') ?? literal('Author'),
    created: toIso(hex('CreationDate') ?? literal('CreationDate')),
    modified: toIso(hex('ModDate') ?? literal('ModDate')),
    application: hex('Producer') ?? literal('Producer'),
  };
}

/** Merge two metadata objects, later values filling only the gaps the first left. */
export function mergeMetadata(...parts: DocumentMetadata[]): DocumentMetadata {
  const out: DocumentMetadata = {};
  for (const p of parts) {
    for (const key of ['title', 'author', 'created', 'modified', 'application', 'company'] as const) {
      if (!out[key] && p[key]) out[key] = p[key];
    }
  }
  return out;
}
