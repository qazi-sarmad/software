/**
 * S13 (§9, F39): findings-to-report provenance.
 *
 * A Systeligon finding carries its rule id, its version and the source rows it flagged. The report
 * writer must render that finding with the provenance intact and must **never restate it in its own
 * words** — a restatement is exactly where a fact can drift (§9.4). This module is the bridge: it
 * turns a `RuleFinding` into a report claim whose phrase is a finding family, whose slots carry the
 * reason, whose `ruleId`/`ruleVersion` come from the finding (not invented), and whose `references`
 * name the flagged rows. The claim then hashes through `graph.ts` like any other, so the graph root
 * moves when a flagged row moves and stays put when only the wording changes.
 *
 * Pure: the clock is `fixedTimestamp` (here `evaluatedAt`), nothing is generated, nothing is read.
 */
import { sha256Hex } from '../writing/canonical';
import type { Claim, Reference } from '../writing/types';
import type { RuleFinding } from './types';

/** One finding, rendered into a claim. The finding's provenance is copied, never re-derived. */
export interface FindingClaim {
  claim: Claim;
  /** The rule that produced the finding — recorded so a sealed report can be re-run verbatim. */
  ruleId: string;
  ruleVersion: number;
  /** The rows the finding flagged, as report references. */
  referenceIds: string[];
}

/** A reference to a flagged row, hashed by its type and id like every other report reference. */
async function refOf(type: string, id: string): Promise<Reference> {
  return { type, id, contentHash: await sha256Hex(`${type}:${id}`) };
}

/**
 * The reference type a finding's refs become. A finding's `refs` are opaque strings to the engine
 * (source row keys, document clause ids, action-item ids); the caller declares how to read them so
 * the reference type is honest rather than guessed. Default: `source_row`.
 */
export type RefKind = (ref: string) => string;

/**
 * Turn one finding into a report claim. `index` makes the claim id stable and ordered.
 *
 * The claim is `calculated` and its phrase is `finding.<kind>`: the report states *that* the finding
 * exists, its rule and its version, and cites the rows — it does not paraphrase the finding's reason
 * into new prose. The reason text travels in an `auditorText`-free slot so it is a *quoted* fact, not
 * a generated sentence. `sectionId` is `findings`, so the writer files it under the findings section.
 */
export async function findingToClaim(
  finding: RuleFinding, index: number, refKind: RefKind = () => 'source_row',
): Promise<FindingClaim> {
  const references = await Promise.all(finding.refs.map((r) => refOf(refKind(r), r)));
  const claim: Claim = {
    id: `finding-${index}-${finding.ruleId}`,
    kind: 'calculated',
    claimLevel: 'calculated',
    phraseId: 'findings.rule_finding',
    phraseVersion: 1,
    // The provenance is the finding's: a claim cannot misreport which rule scored it.
    ruleId: finding.ruleId,
    ruleVersion: finding.ruleVersion,
    slots: [
      { name: 'rule', kind: 'text', value: finding.ruleId },
      { name: 'version', kind: 'number', value: finding.ruleVersion },
      { name: 'kind', kind: 'text', value: finding.kind },
      { name: 'severity', kind: 'text', value: finding.severity },
      // The scope is part of the claim's facts: a population finding and a document finding of the
      // same rule must not hash to one claim, or a sealed report could conflate the two scopes.
      { name: 'scope', kind: 'text', value: finding.scope ?? 'population' },
      { name: 'reason', kind: 'text', value: finding.reason },
      { name: 'refs', kind: 'list', value: [...finding.refs] },
    ],
    references,
    figures: [],
    modelId: 'M1',
    sectionId: 'findings',
    approval: null,
  };
  return { claim, ruleId: finding.ruleId, ruleVersion: finding.ruleVersion, referenceIds: [...finding.refs] };
}

export interface ProvenanceSet {
  claims: Claim[];
  /** Every rule that scored a finding, with its version — the provenance a sealed report stores. */
  rules: Array<{ ruleId: string; ruleVersion: number }>;
}

/**
 * Turn a run's findings into report claims, in run order so the graph root is reproducible.
 *
 * Two identical runs produce the same claims and the same root; a run whose rule version changed
 * produces a different root, because the version is part of the claim facts — which is the property
 * that makes a sealed report provable rather than merely plausible.
 */
export async function findingsToClaims(
  findings: RuleFinding[], refKind: RefKind = () => 'source_row',
): Promise<ProvenanceSet> {
  const detailed = await Promise.all(findings.map((f, i) => findingToClaim(f, i, refKind)));
  // One entry per rule id, newest version wins, ordered by id so the set is deterministic.
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.ruleId, Math.max(byRule.get(f.ruleId) ?? 0, f.ruleVersion));
  const rules = [...byRule.entries()]
    .map(([ruleId, ruleVersion]) => ({ ruleId, ruleVersion }))
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  return { claims: detailed.map((d) => d.claim), rules };
}
