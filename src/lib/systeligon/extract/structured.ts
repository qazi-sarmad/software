/**
 * Systeligon structured extraction, tier 3 (spec §5). Given the text a tier-1 extractor produced, this
 * parses it into *structure* — headings, numbered clauses, labelled fields, action items, signature
 * blocks — using **declared, deterministic parsers**. It does not understand the prose; it matches
 * declared shapes and reports what it matched and what it did not.
 *
 * Tier 3 in the spec is: "declared parsers for vendor/date/amount/reference/period/signature-presence."
 * Those are the `field` elements below. Nothing here calls a model, hits the network, or reads a clock.
 */
import type { DocumentElement, ParsedDocument } from '../types';

/** A declared field parser: a label pattern and how to pull the value from a line. */
interface FieldParser {
  label: string;
  re: RegExp;
}

/**
 * The declared label to field parsers. Each matches a line and captures the value. They are data, so
 * the set of fields the engine recognises is explicit and reviewable, not buried in control flow.
 */
export const FIELD_PARSERS: FieldParser[] = [
  { label: 'vendor', re: /^\s*(?:vendor|supplier|from|payee)\s*[:\-]\s*(.+)$/i },
  { label: 'date', re: /^\s*(?:date|dated|invoice date|posting date)\s*[:\-]\s*(.+)$/i },
  { label: 'amount', re: /^\s*(?:amount|total|value|sum)\s*[:\-]\s*(.+)$/i },
  { label: 'reference', re: /^\s*(?:reference|ref|invoice(?:\s*(?:no|number|#))?|document(?:\s*(?:no|number|#))?|po(?:\s*(?:no|number|#))?)\s*[:\-]\s*(.+)$/i },
  { label: 'period', re: /^\s*(?:period|for the period|covering)\s*[:\-]\s*(.+)$/i },
];

/** Numbered clause: `1.`, `2.3`, `4.1.2` at the start of a line. */
const CLAUSE_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$/;
/** An action item: `Action: <text>` or a line carrying an Owner and a Due date. */
const ACTION_RE = /^\s*(?:action|follow[- ]?up)\s*[:\-]\s*(.+)$/i;
const OWNER_RE = /owner\s*[:\-]\s*([^,;]+)/i;
const DUE_RE = /(?:due|by)\s*[:\-]\s*([^,;]+)/i;
/** A heading: a short line with no sentence punctuation, often title case, optionally numbered. */
const HEADING_RE = /^\s*(?:\d+(?:\.\d+)*\s+)?[A-Z][A-Za-z0-9 ,&'/-]{2,60}$/;
/** Signature presence: a signature block marker. */
const SIGNATURE_RE = /^\s*(?:signed|signature|signatures)\b[:\-]?\s*(.*)$/i;
/** An explicit cross-reference, e.g. `see 4.2`, `ref 9.9`, `(4.1)`. */
const XREF_RE = /(?:see|ref(?:erence)?|clause|section|per)\s+(\d+(?:\.\d+)*)|\((\d+(?:\.\d+)*)\)/gi;

function crossRefsIn(line: string): string[] {
  const out = new Set<string>();
  for (const m of line.matchAll(XREF_RE)) out.add(m[1] ?? m[2]);
  return [...out];
}

export interface StructuredExtraction {
  document: ParsedDocument;
  /** How many lines were read and how many became elements — part of "reports its own coverage". */
  coverage: { lines: number; parsed: number; uninterpreted: number };
}

/**
 * Parse text into a `ParsedDocument`. `ref` names the document; `kind` is what it claims to be. Every
 * element carries its 1-based line so a finding can show the passage and its location. Lines that
 * match nothing are counted as uninterpreted and are never silently dropped from the coverage count.
 */
export function parseDocumentStructure(text: string, kind: ParsedDocument['kind'], ref: string): StructuredExtraction {
  const lines = text.split(/\r?\n/);
  const elements: DocumentElement[] = [];
  let uninterpreted = 0;
  let n = 0;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    n += 1;
    const lineNo = i + 1;
    const id = (suffix: string) => `${ref}:${lineNo}${suffix}`;

    const action = line.match(ACTION_RE);
    if (action) {
      const owner = line.match(OWNER_RE)?.[1]?.trim();
      const due = line.match(DUE_RE)?.[1]?.trim();
      elements.push({ ref: id('.action'), role: 'action_item', line: lineNo, label: owner, value: due });
      return;
    }
    const sig = line.match(SIGNATURE_RE);
    if (sig) {
      elements.push({ ref: id('.sig'), role: 'signature', line: lineNo, value: sig[1]?.trim() || undefined });
      return;
    }
    for (const p of FIELD_PARSERS) {
      const m = line.match(p.re);
      if (m) {
        elements.push({ ref: id(`.${p.label}`), role: 'field', line: lineNo, label: p.label, value: m[1].trim() });
        return;
      }
    }
    const clause = line.match(CLAUSE_RE);
    if (clause) {
      elements.push({ ref: id('.clause'), role: 'clause', line: lineNo, label: clause[1], value: clause[2].trim(), crossRefs: crossRefsIn(line) });
      return;
    }
    if (HEADING_RE.test(line)) {
      elements.push({ ref: id('.heading'), role: 'heading', line: lineNo, value: line });
      return;
    }
    // A line carrying an explicit cross-reference but no other role is a reference element.
    const refs = crossRefsIn(line);
    if (refs.length) {
      elements.push({ ref: id('.ref'), role: 'reference', line: lineNo, value: line, crossRefs: refs });
      return;
    }
    uninterpreted += 1;
  });

  return {
    document: { ref, kind, elements },
    coverage: { lines: n, parsed: elements.length, uninterpreted },
  };
}

/** Signature presence for a document: true when any signature element was found. */
export function hasSignature(doc: ParsedDocument): boolean {
  return doc.elements.some((e) => e.role === 'signature');
}
