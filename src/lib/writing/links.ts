/**
 * Hyperlinks and cross-references (WP-D).
 *
 * A report may carry a hyperlink (an external URL) and a cross-reference (a pointer to a heading or a
 * figure inside the same report). A cross-reference is resolved to the target's own page by the page
 * model, so the printed number can never disagree with where the target actually is.
 *
 * Pure: no clock, no randomness, no DOM.
 */

export const LINK_LIMITS = {
  labelMaxLength: 120,
  urlMaxLength: 2048,
  targetMaxLength: 120,
} as const;

/** A hyperlink: a visible label and a target URL. */
export interface HyperlinkSpec {
  id: string;
  label: string;
  url: string;
  /** Whether the link is printed with the underline the design language uses. */
  underline: boolean;
}

export type ReferenceKind = 'heading' | 'figure' | 'table';

/** A cross-reference: a visible label that points at a heading, a figure or a table by key. */
export interface CrossReferenceSpec {
  id: string;
  kind: ReferenceKind;
  /** The block key, or the figure id, the reference points at. */
  targetKey: string;
  /** The text printed before the resolved number, e.g. "see". */
  label: string;
}

/** Only http(s) URLs are allowed: a report can never carry a `javascript:` or `data:` link. */
export function isSafeUrl(url: string): boolean {
  const v = (url || '').trim();
  if (v === '') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Validate a hyperlink. Returns the first problem, or null when the link is safe. */
export function hyperlinkError(link: HyperlinkSpec): string | null {
  if (link.label.trim() === '') return 'A link needs a label.';
  if (link.label.length > LINK_LIMITS.labelMaxLength) return `The label must be ${LINK_LIMITS.labelMaxLength} characters or fewer.`;
  if (link.url.length > LINK_LIMITS.urlMaxLength) return 'The address is too long.';
  if (!isSafeUrl(link.url)) return 'The address must start with http:// or https://.';
  return null;
}

/** A reference resolved against the page model: the page the target actually landed on. */
export interface ResolvedReference {
  id: string;
  /** The printed text, e.g. "see Scope, page 3" or "see Figure 2, page 5". */
  text: string;
  page: number | null;
  /** The target's ordinal among its own kind (the number a reader counts to). */
  ordinal: number | null;
}

/** The target a reference resolves against: its key, its page, and its ordinal. */
export interface ReferenceTarget {
  key: string;
  page: number;
  ordinal: number;
  label: string;
}

/**
 * Resolve one cross-reference against the targets the page model knows. A reference whose target is
 * absent resolves to a defined "not found" text, never a blank or a throw, so a report always prints.
 */
export function resolveReference(ref: CrossReferenceSpec, targets: ReferenceTarget[]): ResolvedReference {
  const target = targets.find((t) => t.key === ref.targetKey);
  if (!target) {
    return { id: ref.id, text: `${ref.label} ${ref.targetKey} (not found)`, page: null, ordinal: null };
  }
  const noun = ref.kind === 'figure' ? 'Figure' : ref.kind === 'table' ? 'Table' : 'section';
  const head = ref.kind === 'heading'
    ? `${ref.label} ${target.label}`
    : `${ref.label} ${noun} ${target.ordinal}`;
  return { id: ref.id, text: `${head}, page ${target.page}`, page: target.page, ordinal: target.ordinal };
}

/** Build the target list from a page model's block boxes. Pure: the ordinals follow reading order. */
export function referenceTargets(
  boxes: { key: string; label: string; page: number }[], figures: { key: string; label: string; page: number }[],
): ReferenceTarget[] {
  const out: ReferenceTarget[] = [];
  boxes.forEach((b, i) => out.push({ key: b.key, page: b.page, ordinal: i + 1, label: b.label }));
  figures.forEach((f, i) => out.push({ key: f.key, page: f.page, ordinal: i + 1, label: f.label }));
  return out;
}
