/**
 * Explain catalogue — the schema, the assembled data and the pure resolver (docs/EXPLAIN-LAYER.md §1-§2).
 *
 * `explainFor(user, explainId, context?)` is PURE: it takes the user and the (optional) context and
 * returns an `ExplainView`. It reads no clock, no network and no tenant data — the contextual values
 * it shows were handed to it by the host screen, which had already filtered them through
 * `src/lib/access.ts`. It re-checks the caller's rights and redacts, and it NEVER returns nothing: a
 * missing popout looks like a bug.
 *
 * Law L2: the catalogue is static product documentation, safe for any signed-in user. Contextual
 * values are tenant data and are dropped unless the caller holds the value's own right.
 */
import { hasRight, type Right } from '../rights';
import type { User } from '../../types';
import type {
  ExplainContext,
  ExplainContextValue,
  ExplainEntry,
  ExplainView,
} from './types';
import { METHOD_ENTRIES } from './entries.methods';
import { FIELD_ENTRIES, STATUS_ENTRIES, STEP_ENTRIES, TERM_ENTRIES } from './entries.fields';
import { SCREEN_ENTRIES } from './entries.screens';
import { STANDARD_ENTRIES } from './iia';

export * from './types';

/**
 * Every catalogue entry, in a stable order. This is the one place the entries are assembled; the
 * gate (G7) and the resolver both read it, so a new entry cannot be added to a module and missed.
 */
export const EXPLAIN_ENTRIES: ExplainEntry[] = [
  ...METHOD_ENTRIES,
  ...FIELD_ENTRIES,
  ...STATUS_ENTRIES,
  ...STEP_ENTRIES,
  ...TERM_ENTRIES,
  ...SCREEN_ENTRIES,
  ...STANDARD_ENTRIES,
];

const BY_ID: Map<string, ExplainEntry> = new Map(EXPLAIN_ENTRIES.map((e) => [e.id, e]));

export function explainEntry(id: string): ExplainEntry | undefined {
  return BY_ID.get(id);
}

export function explainEntryIds(): string[] {
  return EXPLAIN_ENTRIES.map((e) => e.id);
}

/** The plain-language reason shown when a caller lacks the right to see an entry's detail. */
export const EXPLAIN_DENIED_REASON = 'You do not have access to this detail.';

/**
 * Resolve an explain entry for a user. Pure and total: it always returns a view.
 *
 * - A missing id returns a benign placeholder (never nothing).
 * - If the entry declares `minRight` and the user fails it, the entry is redacted: title and a
 *   one-line reason, with no detail, no effect and no contextual values.
 * - Contextual values whose own `minRight` the user fails are dropped.
 */
export function explainFor(
  user: User | null | undefined,
  explainId: string,
  context?: ExplainContext
): ExplainView {
  const entry = BY_ID.get(explainId);

  if (!entry) {
    return {
      id: explainId,
      status: 'ready',
      kind: 'term',
      title: 'Not documented yet',
      summary: 'There is no catalogue entry for this item yet.',
      effect: 'This is a documentation gap, not a restriction — the item still works as described elsewhere.',
      detail: [],
      howItWorks: [],
      whenToUse: [],
      whenNotToUse: [],
      iiaStandards: [],
      related: [],
      values: [],
    };
  }

  const denied = !!entry.minRight && !hasRight(user, entry.minRight);
  if (denied) {
    return {
      id: entry.id,
      status: 'denied',
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      effect: '',
      detail: [],
      howItWorks: [],
      whenToUse: [],
      whenNotToUse: [],
      iiaStandards: [],
      related: entry.related ?? [],
      source: entry.source,
      values: [],
      deniedReason: EXPLAIN_DENIED_REASON,
    };
  }

  const values = visibleValues(user, context);

  return {
    id: entry.id,
    status: 'ready',
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    effect: entry.effect,
    detail: entry.detail ?? [],
    howItWorks: entry.howItWorks ?? [],
    whenToUse: entry.whenToUse ?? [],
    whenNotToUse: entry.whenNotToUse ?? [],
    iiaStandards: entry.iiaStandards ?? [],
    related: entry.related ?? [],
    source: entry.source,
    values,
  };
}

/** Drop any contextual value whose own right the caller fails. */
function visibleValues(
  user: User | null | undefined,
  context?: ExplainContext
): ExplainContextValue[] {
  const values = context?.values ?? [];
  return values
    .filter((v) => !v.minRight || hasRight(user, v.minRight))
    .map((v) => ({ label: v.label, value: v.value, minRight: v.minRight }));
}

/** The entries that carry a given IIA standard — powers the standards view (§5.4). */
export function entriesForStandard(standardId: string): ExplainEntry[] {
  return EXPLAIN_ENTRIES.filter((e) => (e.iiaStandards ?? []).includes(standardId));
}

/** The entries that satisfy a given right — used by tests and the coverage gate. */
export function entriesRequiringRight(right: Right): ExplainEntry[] {
  return EXPLAIN_ENTRIES.filter((e) => e.minRight === right);
}
