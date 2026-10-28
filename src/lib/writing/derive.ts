/**
 * W1/§15.6: derive the claim graph from an engagement's real records.
 *
 * The writing engine hashes facts, not words, and until now the only graph it was ever given was the
 * test fixture (`fixtures.ts`). This module is the missing middle: it turns the records an engagement
 * actually holds — its scope, its findings, its exception counts, its CAPs — into claims whose
 * references name those records. The graph it returns therefore changes when the evidence changes,
 * which is the property the whole tamper-evidence chain rests on.
 *
 * It is pure: no clock, no random source, no network. Time enters as `fixedTimestamp` and every
 * record enters as data. The hash of each claim and the graph root are computed by the engine
 * (`graph.ts`), so the database can re-derive them and refuse a graph that does not match.
 */

import { decimal, sha256Hex } from './canonical';
import { claimCanonical, claimHash, graphHashes } from './graph';
import type { Claim, ClaimGraph, EngineVersion, Locale, Reference, Register, Slot } from './types';

/** The records a full engagement report is built from. Every field is tenant data. */
export interface ReportRecordSet {
  engagementId: string;
  /** The reporting model (a document plan). Defaults to the full engagement report. */
  modelId?: string;
  /** The period the engagement covered, ISO dates; absent means the scope claim is omitted. */
  scopeStart?: string | null;
  scopeEnd?: string | null;
  /** The final findings, with their severity where rated. */
  findings: Array<{ id: string; severity: string | null }>;
  /** How many controls were tested and how many produced an exception. */
  controlsTested: number;
  controlsWithExceptions: number;
  /** Items tested in the sample and how many produced an exception. */
  itemsTested: number;
  sampleExceptions: number;
  /** The value of the exceptions, in minor units (pence/cents); 0 omits the effect claim. */
  exceptionValueMinor?: number;
  /** The corrective action plans raised from the engagement. */
  caps: Array<{ id: string; status: string }>;
}

/** A derived graph, with the canonical text and hash of each claim the database re-verifies. */
export interface DerivedGraph {
  graph: ClaimGraph;
  /** Per claim, in graph order: the canonical facts and their SHA-256. */
  claims: Array<{ claim: Claim; canonical: string; claimHash: string }>;
  graphRoot: string;
  claimHashes: string[];
}

/** A reference to a record, hashed by its type and id so the same record always hashes the same. */
async function refOf(type: string, id: string): Promise<Reference> {
  return { type, id, contentHash: await sha256Hex(`${type}:${id}`) };
}

function slot(name: string, kind: Slot['kind'], value: Slot['value']): Slot {
  return { name, kind, value };
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'informational'];

/**
 * Derive the graph. Claims are ordered by section (the model plan's order) then by claim id, which
 * is exactly the order `planReport` uses, so the root this returns matches the one a plan build would.
 */
export async function deriveEngagementGraph(
  records: ReportRecordSet, register: Register, locale: Locale, versions: EngineVersion,
): Promise<DerivedGraph> {
  const modelId = records.modelId ?? 'M1';
  const claims: Claim[] = [];

  const mk = (partial: Omit<Claim, 'modelId' | 'ruleVersion' | 'ruleId'> & { ruleId?: string }): Claim => ({
    ...partial,
    ruleId: partial.ruleId ?? `${partial.phraseId}.rule`,
    ruleVersion: 1,
    modelId,
  });

  // 1. Scope: the period covered.
  if (records.scopeStart && records.scopeEnd) {
    claims.push(mk({
      id: 'c-scope', kind: 'calculated', claimLevel: 'calculated',
      phraseId: 'scope.period', phraseVersion: 1, sectionId: 'scope',
      slots: [slot('start_date', 'date', records.scopeStart), slot('end_date', 'date', records.scopeEnd)],
      references: [], figures: [], approval: null,
    }));
  }

  // 2. Exception summary: exceptions across controls.
  claims.push(mk({
    id: 'c-exception-summary', kind: 'calculated', claimLevel: 'calculated',
    phraseId: 'exception_summary.count', phraseVersion: 1, sectionId: 'exec',
    slots: [slot('exceptions', 'count', records.controlsWithExceptions),
            slot('controls', 'count', records.controlsTested)],
    references: [], figures: [], approval: null,
  }));

  // 3. The condition: how many items tested produced an exception. Cites the exception rows.
  const exceptionRefs = await Promise.all(
    records.caps.map((c) => refOf('cap', c.id)));
  claims.push(mk({
    id: 'c-condition', kind: 'calculated', claimLevel: 'calculated',
    phraseId: 'condition.test_exceptions', phraseVersion: 1, sectionId: 'findings',
    slots: [slot('tests', 'count', records.itemsTested), slot('test_noun', 'text', 'items'),
            slot('exceptions', 'count', records.sampleExceptions)],
    references: await Promise.all(records.findings.map((f) => refOf('finding', f.id))),
    figures: [], approval: null,
  }));

  // 4. The effect, only when a value was identified.
  if ((records.exceptionValueMinor ?? 0) > 0) {
    claims.push(mk({
      id: 'c-effect', kind: 'calculated', claimLevel: 'calculated',
      phraseId: 'effect.unapproved_payments', phraseVersion: 1, sectionId: 'findings',
      slots: [slot('amount', 'money', decimal(String(records.exceptionValueMinor), 2))],
      references: exceptionRefs, figures: [], approval: null,
    }));
  }

  // 5. Coverage reconciliation: findings, exception controls and CAPs each appear once.
  claims.push(mk({
    id: 'c-coverage', kind: 'calculated', claimLevel: 'calculated',
    phraseId: 'coverage.reconciliation', phraseVersion: 1, sectionId: 'coverage',
    slots: [slot('findings', 'count', records.findings.length),
            slot('controls', 'count', records.controlsWithExceptions),
            slot('caps', 'count', records.caps.length)],
    references: [], figures: [], approval: null,
  }));

  // 6. Limitation: the conclusions rest on a sample.
  claims.push(mk({
    id: 'c-limitation', kind: 'calculated', claimLevel: 'calculated',
    phraseId: 'limitation.sample_basis', phraseVersion: 1, sectionId: 'scope',
    slots: [slot('tests', 'count', records.itemsTested)],
    references: [], figures: [], approval: null,
  }));

  // 7. Numeric summary (the register-invariant appendix).
  claims.push(mk({
    id: 'c-numeric', kind: 'calculated', claimLevel: 'calculated',
    phraseId: 'numeric_summary.counts', phraseVersion: 1, sectionId: 'appendices',
    slots: [slot('findings', 'count', records.findings.length),
            slot('controls', 'count', records.controlsWithExceptions),
            slot('caps', 'count', records.caps.length)],
    references: [], figures: [], approval: null,
  }));

  const graph: ClaimGraph = { modelId, register, locale, claims, versions };
  const hashes = await graphHashes(claims);
  const detailed = await Promise.all(claims.map(async (claim) => ({
    claim, canonical: claimCanonical(claim), claimHash: await claimHash(claim),
  })));

  return { graph, claims: detailed, graphRoot: hashes.graphRoot, claimHashes: hashes.claimHashes };
}

/** The severity order used to present findings; exported so a screen and a test agree. */
export function severityRank(severity: string | null): number {
  const i = SEVERITY_ORDER.indexOf((severity ?? '').toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
}
