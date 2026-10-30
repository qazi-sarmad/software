/**
 * Systeligon action-item register (S14, spec §3.3). Given minutes in date order, it follows each action
 * item forward across the series and reports the deterministic patterns the spec names: carried
 * forward, vanished, closed with no evidence, reopened, closed before raised, closed by a non-owner,
 * owner/due changed without a recorded decision, and due date passed with no status change.
 *
 * Pure. Time is an argument (`asOf`) — the register never reads a clock. The whole history of an item
 * is derived from the documents, so a finding cites every minute and passage that mentioned it.
 */
import type { ParsedDocument } from './types';

export type ActionStatus = 'open' | 'closed';

/** One appearance of an action item in one minute. */
export interface ActionAppearance {
  documentRef: string;
  /** ISO date of the minute it appeared in. */
  date: string;
  line: number;
  /** The exact text that mentioned it, for the side-by-side view. */
  text: string;
  owner?: string;
  due?: string;
  status: ActionStatus;
  /** Evidence document refs supporting a closure; empty means "closed with no evidence". */
  evidence: string[];
}

export type ActionFindingKind =
  | 'carried_forward'
  | 'vanished'
  | 'closed_no_evidence'
  | 'reopened'
  | 'closed_before_raised'
  | 'closed_by_non_owner'
  | 'owner_changed'
  | 'due_changed'
  | 'due_passed_open';

export interface ActionFinding {
  kind: ActionFindingKind;
  itemId: string;
  /** Every appearance, in date order — the history the finding is derived from. */
  history: ActionAppearance[];
  detail: string;
}

/** Split an action item's `ref` (`<doc>:<line>.action`) into a stable id and its document. */
function docOf(ref: string): string {
  return ref.split(':')[0];
}

/**
 * Build the register from minutes in date order. `asOf` fixes "today" for the passed-due check.
 * A document whose kind is not `minutes` is ignored. Appearances are sorted by document date, then line.
 */
export function buildActionRegister(minutes: ParsedDocument[], asOf: string): ActionFinding[] {
  // Group action items by their stable id. The id is the item's declared `label`+`text` key when
  // present (a repeated item), else its own ref — so an item raised once and mentioned later under a
  // stable id is tracked, and a one-off item is tracked alone.
  const appearances = new Map<string, ActionAppearance[]>();
  for (const doc of minutes) {
    if (doc.kind !== 'minutes') continue;
    const date = doc.date ?? '';
    for (const el of doc.elements) {
      if (el.role !== 'action_item') continue;
      const key = el.attributes?.itemId ?? el.label ?? el.ref;
      const list = appearances.get(key) ?? [];
      list.push({
        documentRef: doc.ref, date, line: el.line, text: el.text ?? el.value ?? '',
        owner: el.label && el.attributes?.owner === undefined ? el.label : el.attributes?.owner,
        due: el.value && el.attributes?.due === undefined ? el.value : el.attributes?.due,
        status: (el.attributes?.status as ActionStatus) ?? 'open',
        evidence: el.attributes?.evidence ? el.attributes.evidence.split(',').map((s) => s.trim()).filter(Boolean) : [],
      });
      appearances.set(key, list);
    }
  }

  const findings: ActionFinding[] = [];
  for (const [itemId, list] of appearances) {
    const history = list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.line - b.line));
    const first = history[0];
    let owner = first.owner;
    let due = first.due;
    let closed = first.status === 'closed';
    let raisedAt = first.date;

    if (first.status === 'closed') {
      findings.push({ kind: 'closed_before_raised', itemId, history, detail: `Item ${itemId} is closed in the minute it was first raised.` });
    }

    for (let i = 1; i < history.length; i += 1) {
      const prev = history[i - 1];
      const cur = history[i];
      if (cur.due && due && cur.due !== due) {
        findings.push({ kind: 'due_changed', itemId, history, detail: `Due date changed from ${due} to ${cur.due} at ${cur.documentRef}:${cur.line} with no recorded decision.` });
      }
      if (cur.owner && owner && cur.owner !== owner) {
        findings.push({ kind: 'owner_changed', itemId, history, detail: `Owner changed from ${owner} to ${cur.owner} at ${cur.documentRef}:${cur.line} with no recorded decision.` });
      }
      if (cur.status === 'closed' && !closed) {
        if (cur.evidence.length === 0) {
          findings.push({ kind: 'closed_no_evidence', itemId, history, detail: `Item ${itemId} is marked done at ${cur.documentRef}:${cur.line} with no supporting document.` });
        }
        if (owner && cur.owner && cur.owner !== owner) {
          findings.push({ kind: 'closed_by_non_owner', itemId, history, detail: `Item ${itemId} is closed by ${cur.owner}, not the owner ${owner}.` });
        }
        closed = true;
      } else if (cur.status === 'open' && closed) {
        findings.push({ kind: 'reopened', itemId, history, detail: `Item ${itemId} was closed and is raised again at ${cur.documentRef}:${cur.line}.` });
        closed = false;
      }
      owner = cur.owner ?? owner;
      due = cur.due ?? due;
      void prev;
    }

    // Carried forward: raised, not closed, and mentioned again but still open.
    if (!closed && history.length > 1) {
      findings.push({ kind: 'carried_forward', itemId, history, detail: `Item ${itemId} is carried across ${history.length} minutes without being closed.` });
    }
    // Vanished: raised, then never appears in any later minute while still open.
    if (!closed && history.length === 1) {
      findings.push({ kind: 'vanished', itemId, history, detail: `Item ${itemId} is raised at ${first.documentRef} and never mentioned again. Silence is a finding.` });
    }
    // Due date has passed with no status change.
    if (!closed && due && due < asOf) {
      findings.push({ kind: 'due_passed_open', itemId, history, detail: `Item ${itemId} was due ${due} and is still open as at ${asOf}.` });
    }
    void raisedAt;
  }

  // Deterministic order: by item id, then kind.
  return findings.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.kind.localeCompare(b.kind));
}

/** The full history of one item, for the UI to show every minute it appeared in. */
export function itemHistory(findings: ActionFinding[], itemId: string): ActionAppearance[] {
  return findings.find((f) => f.itemId === itemId)?.history ?? [];
}
