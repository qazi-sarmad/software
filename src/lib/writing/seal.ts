/**
 * W13.1: the single deterministic seal gate.
 *
 * A report may be sealed only when every deterministic check is clean. Each check already exists as
 * a pure function; this module runs the whole list over one graph and returns a structured report, so
 * a caller (the freeze action, the offline verifier, a test) has one entry point and one answer.
 *
 * Nothing here reads a clock, a random source or the network. Time enters as `timeArgument`, which is
 * also the report date the contradiction rules compare against. There is no AI: every rule is a
 * named, versioned predicate.
 */

import type { ClaimGraph } from './types';
import { planReport } from './planner';
import {
  checkAuditorText, checkReferenceIntegrity, findContradictions, reconcileCoverage,
  type ContradictionInput, type CoverageScope, type KnownRecord,
} from './verify';
import { checkStaleness, type Observation } from './observations';
import { recomputeFigures, type FigureLineage, type SourceRecord } from './figures';
import { DEFAULT_HIGH_CONSEQUENCE_WORDS } from './phrases';

/** The checks the seal gate runs, in a fixed order. */
export type SealCheck = 'references' | 'coverage' | 'contradictions' | 'staleness' | 'plan' | 'figures' | 'auditor';

export interface SealBlocker {
  check: SealCheck;
  /** The claim, figure or observation the blocker belongs to. */
  subject: string;
  detail: string;
}

export interface SealReport {
  /** True only when `blockers` is empty. */
  sealed: boolean;
  blockers: SealBlocker[];
  /** Non-blocking findings (auditor text flagged for a high-consequence word, by design). */
  warnings: SealBlocker[];
}

export interface SealInput {
  graph: ClaimGraph;
  /** The records the report cites, with their current content hash. */
  known: Map<string, KnownRecord>;
  /** The findings, exception controls and CAPs in scope for the coverage check. */
  coverage: CoverageScope;
  /** The contradiction context. Its `reportDate` must equal `timeArgument`. */
  contradictions: Omit<ContradictionInput, 'claims' | 'reportDate'>;
  /** The observations the claims derive from, for the staleness check. */
  observations: Map<string, Observation>;
  /** Stored figure lineage, by claim id. */
  lineageByClaim: Map<string, FigureLineage[]>;
  /** The source records, by table, for the figure recompute. */
  recordsByTable: Map<string, SourceRecord[]>;
  /** The column values, by table then record id, for the figure recompute. */
  columns: Map<string, Map<string, string>>;
  /** The time argument: the report date, used for staleness and the date contradiction. */
  timeArgument: string;
  /** The claim ids a cross-reference may point at. Absent means every claim id is resolvable. */
  resolvableClaimIds?: string[];
  /** The high-consequence words the auditor lane is checked against. Defaults to the engine list. */
  highConsequenceWords?: string[];
}

const blocker = (check: SealCheck, subject: string, detail: string): SealBlocker => ({ check, subject, detail });

/**
 * Run every deterministic check over the graph and return the blockers. The function is pure over its
 * arguments and deterministic: the same input yields the same blockers in the same order.
 */
export async function evaluateSeal(input: SealInput): Promise<SealReport> {
  const claims = input.graph.claims;
  const blockers: SealBlocker[] = [];
  const warnings: SealBlocker[] = [];

  // 1. Reference integrity: every claim cited, every reference resolves, every hash current.
  const integrity = checkReferenceIntegrity(claims, input.known);
  for (const id of integrity.unreferenced) {
    blockers.push(blocker('references', id, 'claim has no reference and is not declared structural'));
  }
  for (const issue of integrity.stale) {
    blockers.push(blocker('references', issue.claimId, `${issue.referenceId}: ${issue.reason}`));
  }

  // 2. Coverage: every fact in scope covered exactly once, no orphaned claim.
  const coverage = reconcileCoverage(claims, input.coverage);
  for (const key of coverage.missing) blockers.push(blocker('coverage', key, 'fact in scope is covered by no claim'));
  for (const key of coverage.duplicated) blockers.push(blocker('coverage', key, 'fact in scope is covered by more than one claim'));
  for (const id of coverage.orphaned) blockers.push(blocker('coverage', id, 'claim covers no fact in scope'));

  // 3. Contradictions: named, versioned rules.
  const contradictions = findContradictions({
    claims, reportDate: input.timeArgument, ...input.contradictions,
  });
  for (const c of contradictions) {
    blockers.push(blocker('contradictions', c.claimId, `${c.ruleId} v${c.ruleVersion}: ${c.message}`));
  }

  // 4. Staleness: an approved observation that changed or was reopened blocks the freeze.
  const staleness = checkStaleness(claims, input.observations);
  for (const id of staleness.staleClaims) {
    blockers.push(blocker('staleness', id, 'the observation it derives from changed or is no longer approved'));
  }

  // 5. The document plan: a broken cross-reference or an unknown section blocks the freeze.
  const planned = planReport({
    modelId: input.graph.modelId,
    register: input.graph.register,
    locale: input.graph.locale,
    claims,
    versions: input.graph.versions,
    resolvableClaimIds: input.resolvableClaimIds,
  });
  for (const ref of planned.brokenReferences) {
    blockers.push(blocker('plan', ref, 'cross-reference or section does not resolve'));
  }

  // 6. Figures: every bound figure recomputes to the same value and the same lineage hash.
  const differences = await recomputeFigures(
    claims.map((c) => ({ id: c.id, figures: c.figures })),
    input.lineageByClaim, input.recordsByTable, input.columns, input.timeArgument,
  );
  for (const d of differences) {
    blockers.push(blocker('figures', `${d.claimId}/${d.figureId}`,
      `stored ${d.stored}, recomputed ${d.recomputed}`));
  }

  // 7. The auditor lane: missing author or time blocks; a high-consequence word is flagged, not blocked.
  for (const issue of checkAuditorText(claims, input.highConsequenceWords ?? DEFAULT_HIGH_CONSEQUENCE_WORDS)) {
    const target = issue.reason.startsWith('contains the high-consequence word') ? warnings : blockers;
    target.push(blocker('auditor', issue.claimId, issue.reason));
  }

  return { sealed: blockers.length === 0, blockers, warnings };
}
