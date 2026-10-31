/**
 * Released-pack resolution (S10/S11, spec §4). A released pack is a value the rule-run screen runs,
 * not just a row. The database stores a pack's rules as data (id, version, kind, params); this module
 * turns that data back into the executable rules, so the engine runs what was actually released
 * rather than the in-code default.
 *
 * A rule the client cannot reconstruct is dropped and reported — the run must never invent a rule it
 * cannot execute, and must never silently substitute a different one.
 */
import type { RuleStatus, SysteligonRule } from './types';
import { systeligonPopulationRules } from './library';
import { structuralRules } from './rules/structural';
import { documentRules } from './rules/documents';
import { patternRules } from './rules/patterns';
import { sequentialRules } from './rules/sequential';
import { buildAdhocRule, type AdhocRuleSpec } from './ota';

/** Every shipped, executable rule, keyed by `id@version`. The released-pack resolver reads this. */
const SHIPPED: SysteligonRule[] = [
  ...systeligonPopulationRules,
  ...structuralRules,
  ...documentRules,
  ...patternRules,
  ...sequentialRules,
];
const byRef = new Map(SHIPPED.map((r) => [`${r.id}@${r.version}`, r]));

/** One rule as it is stored in a pack: identity, kind, and the parameters it was configured with. */
export interface ReleasedPackRule {
  id: string;
  version: number;
  kind?: string;
  severity?: string;
  status?: string;
  title?: string;
  params?: Record<string, unknown>;
}

/** A released pack as the reader returns it. */
export interface ReleasedPack {
  name: string;
  version: number;
  target: string;
  contentHash: string;
  rules: ReleasedPackRule[];
}

/**
 * Reconstruct the executable rules a released pack names. A shipped `id@version` resolves to its
 * implementation; an ad-hoc rule (no shipped implementation) is rebuilt from the spec in its params.
 * Anything else is dropped and named in `missing`, so the caller can report the gap rather than run a
 * rule set that is quietly different from the pack.
 */
export function resolveReleasedRules(pack: ReleasedPack): { rules: SysteligonRule[]; missing: string[] } {
  const rules: SysteligonRule[] = [];
  const missing: string[] = [];
  for (const entry of pack.rules ?? []) {
    const ref = `${entry.id}@${entry.version}`;
    const shipped = byRef.get(ref);
    if (shipped) {
      rules.push(shipped);
      continue;
    }
    const spec = entry.params as AdhocRuleSpec | undefined;
    if (spec && typeof spec.source === 'string' && typeof spec.condition === 'string') {
      rules.push(buildAdhocRule(spec, (entry.status as RuleStatus) ?? 'released'));
      continue;
    }
    missing.push(ref);
  }
  return { rules, missing };
}
