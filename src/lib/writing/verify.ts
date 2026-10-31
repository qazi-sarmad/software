/**
 * W5: claim verification and coverage.
 *
 * 5.1 Reference integrity: every claim has at least one reference (structural claims declared as
 *     such excepted); every reference resolves to an existing record whose current content hash
 *     equals the stored one, else the claim is flagged stale.
 * 5.2 Coverage reconciliation: every approved finding, every exception control and every CAP in
 *     scope appears exactly once; no claim orphaned; no duplicate claim for the same fact.
 * 5.3 Deterministic contradiction rules (named, versioned, tested predicates).
 * 5.4 The auditor-text lane.
 */

import type { Claim } from './types';

/** A record the report cites, with its current content hash. */
export interface KnownRecord {
  type: string;
  id: string;
  contentHash: string;
}

export interface ReferenceIssue {
  claimId: string;
  referenceId: string;
  reason: string;
}

/** A claim whose references are structural (a section header, a scope statement) declares itself
 *  so; it is excepted from the at-least-one-reference rule. */
export function isStructural(claim: Claim): boolean {
  return claim.kind === 'derived' && claim.claimLevel === 'verified' && (claim.crossReferences?.length ?? 0) === 0
    && claim.references.length === 0;
}

export interface IntegrityReport {
  /** Claims with no reference at all and not declared structural. */
  unreferenced: string[];
  /** References that do not resolve, or whose content hash changed. */
  stale: ReferenceIssue[];
  /** Claims that reference a record whose hash changed since composition. */
  staleClaims: string[];
  ok: boolean;
}

/**
 * W5.1: reference integrity. Every claim needs at least one reference unless it is declared
 * structural; every reference must resolve to a known record with the same current content hash.
 */
export function checkReferenceIntegrity(claims: Claim[], known: Map<string, KnownRecord>): IntegrityReport {
  const unreferenced: string[] = [];
  const stale: ReferenceIssue[] = [];
  const staleClaims = new Set<string>();
  for (const claim of claims) {
    if (claim.kind === 'auditor') continue;
    if (claim.references.length === 0 && !isStructural(claim)) {
      unreferenced.push(claim.id);
      continue;
    }
    for (const ref of claim.references) {
      const record = known.get(`${ref.type}:${ref.id}`);
      if (!record) {
        stale.push({ claimId: claim.id, referenceId: `${ref.type}:${ref.id}`, reason: 'does not resolve' });
        staleClaims.add(claim.id);
      } else if (record.contentHash !== ref.contentHash) {
        stale.push({ claimId: claim.id, referenceId: `${ref.type}:${ref.id}`, reason: 'content hash changed' });
        staleClaims.add(claim.id);
      }
    }
  }
  unreferenced.sort();
  stale.sort((a, b) => (a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : a.referenceId < b.referenceId ? -1 : 1));
  return {
    unreferenced,
    stale,
    staleClaims: [...staleClaims].sort(),
    ok: unreferenced.length === 0 && stale.length === 0,
  };
}

// ---------------------------------------------------------------------------
// W5.2 Coverage reconciliation
// ---------------------------------------------------------------------------

export interface CoverageScope {
  /** The approved findings in scope, by id. */
  findingIds: string[];
  /** The exception controls in scope, by id. */
  exceptionControlIds: string[];
  /** The corrective action plans in scope, by id. */
  capIds: string[];
}

export interface CoverageReport {
  /** Facts in scope that no claim covers. */
  missing: string[];
  /** Facts covered by more than one claim. */
  duplicated: string[];
  /** Claims that cover no fact in scope. */
  orphaned: string[];
  ok: boolean;
}

/**
 * W5.2: every approved finding, exception control and CAP in scope appears exactly once; no claim
 * orphaned; no duplicate claim for the same fact. A claim's coverage key is `<type>:<id>`.
 */
export function reconcileCoverage(claims: Claim[], scope: CoverageScope): CoverageReport {
  const inScope = new Set<string>([
    ...scope.findingIds.map((id) => `finding:${id}`),
    ...scope.exceptionControlIds.map((id) => `control:${id}`),
    ...scope.capIds.map((id) => `cap:${id}`),
  ]);
  const counts = new Map<string, string[]>();
  for (const claim of claims) {
    for (const key of coverageKeys(claim)) {
      const list = counts.get(key) ?? [];
      list.push(claim.id);
      counts.set(key, list);
    }
  }
  const missing: string[] = [];
  for (const key of inScope) if (!counts.has(key)) missing.push(key);
  const duplicated: string[] = [];
  for (const [key, list] of counts) {
    if (inScope.has(key) && list.length > 1) duplicated.push(`${key} (${[...list].sort().join(', ')})`);
  }
  const orphaned: string[] = [];
  for (const claim of claims) {
    const keys = coverageKeys(claim);
    if (keys.length === 0) continue;
    if (!keys.some((k) => inScope.has(k))) orphaned.push(claim.id);
  }
  missing.sort();
  duplicated.sort();
  orphaned.sort();
  return { missing, duplicated, orphaned, ok: missing.length === 0 && duplicated.length === 0 && orphaned.length === 0 };
}

/** The coverage keys a claim names: its references to findings, controls and CAPs. */
function coverageKeys(claim: Claim): string[] {
  const keys: string[] = [];
  for (const ref of claim.references) {
    if (ref.type === 'finding' || ref.type === 'control' || ref.type === 'cap') {
      keys.push(`${ref.type}:${ref.id}`);
    }
  }
  for (const xref of claim.crossReferences ?? []) keys.push(`claim:${xref}`);
  return keys;
}

// ---------------------------------------------------------------------------
// W5.3 Deterministic contradiction rules
// ---------------------------------------------------------------------------

export interface ContradictionInput {
  claims: Claim[];
  /** The report date (the time argument), so a date later than it can be found. */
  reportDate: string;
  /** The current state of each CAP, by id. */
  capState: Map<string, 'open' | 'closed' | 'overdue'>;
  /** The risk rating linked to each finding, by id. */
  riskRating: Map<string, string>;
  /** The severity each finding's claim states, by finding id. */
  findingSeverity: Map<string, string>;
  /** Findings whose severity is overridden by the auditor, with a reason. */
  auditorOverrides: Map<string, string>;
  /** The alerts that were dismissed, by id. */
  dismissedAlerts: Set<string>;
  /** The claim ids that derive from an alert, mapped to the alert id. */
  claimAlert: Map<string, string>;
}

export interface Contradiction {
  ruleId: string;
  ruleVersion: number;
  claimId: string;
  message: string;
}

/** The named, versioned contradiction rules. */
export const CONTRADICTION_RULES: Array<{ id: string; version: number; description: string }> = [
  { id: 'contradiction.same_figure_two_values', version: 1, description: 'The same figure appears with two different values.' },
  { id: 'contradiction.severity_risk_mismatch', version: 1, description: 'A finding severity differs from its linked risk rating without an explicit auditor override.' },
  { id: 'contradiction.status_vs_cap', version: 1, description: 'A status claim of closed contradicts the CAP state.' },
  { id: 'contradiction.date_after_report', version: 1, description: 'A date is later than the report date.' },
  { id: 'contradiction.alert_dismissed', version: 1, description: 'A claim derives from an alert that was dismissed.' },
];

/** W5.3: find every contradiction. Deterministic; no inference. */
export function findContradictions(input: ContradictionInput): Contradiction[] {
  const out: Contradiction[] = [];
  const byFigure = new Map<string, Map<string, string[]>>();
  for (const claim of input.claims) {
    for (const fig of claim.figures) {
      const key = `${fig.figureId}@${fig.figureVersion}`;
      const values = byFigure.get(key) ?? new Map<string, string[]>();
      const list = values.get(fig.result) ?? [];
      list.push(claim.id);
      values.set(fig.result, list);
      byFigure.set(key, values);
    }
  }
  for (const [key, values] of byFigure) {
    if (values.size > 1) {
      for (const [value, claimIds] of values) {
        for (const claimId of claimIds) {
          out.push({
            ruleId: 'contradiction.same_figure_two_values', ruleVersion: 1, claimId,
            message: `figure ${key} appears with value ${value} and also with another value`,
          });
        }
      }
    }
  }

  for (const claim of input.claims) {
    // Severity vs risk rating.
    for (const ref of claim.references) {
      if (ref.type !== 'finding') continue;
      const stated = input.findingSeverity.get(ref.id);
      const rating = input.riskRating.get(ref.id);
      if (stated && rating && stated !== rating && !input.auditorOverrides.has(ref.id)) {
        out.push({
          ruleId: 'contradiction.severity_risk_mismatch', ruleVersion: 1, claimId: claim.id,
          message: `finding ${ref.id} states severity ${stated} but its risk rating is ${rating}, with no auditor override`,
        });
      }
    }
    // Status vs CAP.
    if (claim.phraseId.startsWith('status.')) {
      const capId = claim.references.find((r) => r.type === 'cap')?.id;
      if (capId) {
        const state = input.capState.get(capId);
        const saysClosed = claim.phraseId === 'status.closed';
        if (state === 'open' && saysClosed) {
          out.push({
            ruleId: 'contradiction.status_vs_cap', ruleVersion: 1, claimId: claim.id,
            message: `claim says the finding is closed but CAP ${capId} is open`,
          });
        }
        if (state === 'closed' && claim.phraseId === 'status.open') {
          out.push({
            ruleId: 'contradiction.status_vs_cap', ruleVersion: 1, claimId: claim.id,
            message: `claim says the finding is open but CAP ${capId} is closed`,
          });
        }
      }
    }
    // Date after the report date.
    for (const slot of claim.slots) {
      if (slot.kind === 'date' && typeof slot.value === 'string' && slot.value > input.reportDate) {
        out.push({
          ruleId: 'contradiction.date_after_report', ruleVersion: 1, claimId: claim.id,
          message: `slot ${slot.name} is ${slot.value}, later than the report date ${input.reportDate}`,
        });
      }
    }
    // Alert dismissed.
    const alertId = input.claimAlert.get(claim.id);
    if (alertId && input.dismissedAlerts.has(alertId)) {
      out.push({
        ruleId: 'contradiction.alert_dismissed', ruleVersion: 1, claimId: claim.id,
        message: `claim derives from alert ${alertId}, which was dismissed`,
      });
    }
  }
  out.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : a.claimId < b.claimId ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------------------
// W5.4 The auditor-text lane
// ---------------------------------------------------------------------------

export interface AuditorTextIssue {
  claimId: string;
  reason: string;
}

/**
 * W5.4: auditor text is kind='auditor', labelled as auditor text in every output, exempt only from
 * phrase use and slot discipline, and flagged (not blocked) if it contains a high-consequence word,
 * because the wording is theirs. It always carries author and time from the ledger.
 */
export function checkAuditorText(claims: Claim[], highConsequence: string[]): AuditorTextIssue[] {
  const issues: AuditorTextIssue[] = [];
  for (const claim of claims) {
    if (claim.kind !== 'auditor') continue;
    if (!claim.auditorAuthor) issues.push({ claimId: claim.id, reason: 'auditor text has no author' });
    if (!claim.auditorAt) issues.push({ claimId: claim.id, reason: 'auditor text has no time' });
    const text = (claim.auditorText ?? '').toLowerCase();
    for (const word of highConsequence) {
      if (text.includes(word.toLowerCase())) {
        issues.push({ claimId: claim.id, reason: `contains the high-consequence word "${word}" (flagged, not blocked)` });
      }
    }
  }
  return issues;
}

/** The label every output puts on auditor text (W5.4). */
export function auditorLabel(claim: Claim): string | null {
  if (claim.kind !== 'auditor') return null;
  return `Auditor text, ${claim.auditorAuthor ?? 'unknown'}, ${claim.auditorAt ?? 'unknown'}`;
}
