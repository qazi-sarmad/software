/**
 * §11.4: the central pre-flight before submission.
 *
 * One named, deterministic module runs the full list of checks over an engagement's testing state and
 * returns a structured report. Nothing here is AI and nothing reads a clock: the time argument is
 * supplied by the caller. The eight checks are the spec's list plus the population gate, which the
 * same submission already depends on:
 *
 *   1. exceptions_without_rationale
 *   2. unresolved_flags
 *   3. missing_evidence
 *   4. sample_below_floor
 *   5. reviewer_equals_preparer
 *   6. incomplete_findings
 *   7. unanswered_comments
 *   8. population_gate
 *
 * Submission is blocked while any check is open, unless every open item is acknowledged with a
 * logged reason. An acknowledgement is keyed by check and by the item it covers, so acknowledging one
 * exception does not wave through another.
 */

export const PREFLIGHT_CHECKS = [
  'exceptions_without_rationale',
  'unresolved_flags',
  'missing_evidence',
  'sample_below_floor',
  'reviewer_equals_preparer',
  'incomplete_findings',
  'unanswered_comments',
  'population_gate',
] as const;
export type PreflightCheck = (typeof PREFLIGHT_CHECKS)[number];

/** A single open item the pre-flight found. `itemId` is stable, so an acknowledgement can name it. */
export interface PreflightItem {
  check: PreflightCheck;
  /** A stable identifier for the item: a row id, a comment id, a control id. */
  itemId: string;
  /** A plain-words description shown to the auditor. */
  detail: string;
}

/** An acknowledgement the auditor recorded, with the reason. Append-only in the database. */
export interface PreflightAcknowledgement {
  check: PreflightCheck;
  itemId: string;
  reason: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

/** The facts the checks read. Every field is data the caller supplies; the module reads nothing else. */
export interface PreflightInput {
  exceptions: Array<{ id: string; rationale: string | null }>;
  flags: Array<{ id: string; resolved: boolean }>;
  evidence: Array<{ id: string; required: boolean; present: boolean }>;
  sample: { requiredFloor: number; actualSize: number };
  signOffs: Array<{ workpaperId: string; preparerId: string; reviewerId: string | null }>;
  findings: Array<{ id: string; complete: boolean }>;
  comments: Array<{ id: string; answered: boolean }>;
  population: { gateMet: boolean };
  /** The acknowledgements recorded so far, from the append-only log. */
  acknowledgements: PreflightAcknowledgement[];
}

export interface PreflightResult {
  /** True when every open item is acknowledged with a non-empty reason. */
  passed: boolean;
  /** Every open item, acknowledged or not, in a fixed check order. */
  items: PreflightItem[];
  /** The open items that carry no acknowledgement: these block submission. */
  blocking: PreflightItem[];
}

/** The eight checks, each a pure predicate over the input. */
export function runPreflight(input: PreflightInput): PreflightResult {
  const items: PreflightItem[] = [];
  const push = (check: PreflightCheck, itemId: string, detail: string) => items.push({ check, itemId, detail });

  for (const e of input.exceptions) {
    if (!e.rationale || e.rationale.trim().length === 0) {
      push('exceptions_without_rationale', e.id, 'An exception has no rationale.');
    }
  }
  for (const f of input.flags) {
    if (!f.resolved) push('unresolved_flags', f.id, 'A flag is unresolved.');
  }
  for (const ev of input.evidence) {
    if (ev.required && !ev.present) push('missing_evidence', ev.id, 'Required evidence is missing.');
  }
  if (input.sample.actualSize < input.sample.requiredFloor) {
    push('sample_below_floor', 'sample', `The sample is ${input.sample.actualSize}, below the floor of ${input.sample.requiredFloor}.`);
  }
  for (const s of input.signOffs) {
    if (s.reviewerId !== null && s.reviewerId === s.preparerId) {
      push('reviewer_equals_preparer', s.workpaperId, 'The reviewer is the preparer.');
    }
  }
  for (const f of input.findings) {
    if (!f.complete) push('incomplete_findings', f.id, 'A finding is incomplete.');
  }
  for (const c of input.comments) {
    if (!c.answered) push('unanswered_comments', c.id, 'A comment has no answer.');
  }
  if (!input.population.gateMet) {
    push('population_gate', 'population', 'The population gate is not met.');
  }

  // Stable order: by check order, then by item id, so the report is deterministic.
  const checkOrder = new Map(PREFLIGHT_CHECKS.map((c, i) => [c, i]));
  items.sort((a, b) => (checkOrder.get(a.check)! - checkOrder.get(b.check)!)
    || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const acked = new Set(input.acknowledgements
    .filter((a) => a.reason.trim().length > 0)
    .map((a) => `${a.check}\u0001${a.itemId}`));
  const blocking = items.filter((i) => !acked.has(`${i.check}\u0001${i.itemId}`));

  return { passed: blocking.length === 0, items, blocking };
}

/** The check keys, for a screen that lists the pre-flight by check. */
export function preflightSummary(result: PreflightResult): Record<PreflightCheck, number> {
  const summary = Object.fromEntries(PREFLIGHT_CHECKS.map((c) => [c, 0])) as Record<PreflightCheck, number>;
  for (const item of result.items) summary[item.check] += 1;
  return summary;
}
