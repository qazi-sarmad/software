/**
 * The shipped Systeligon rule library (S6, spec §3.1). A named, versioned set of the released rules
 * the rule-run screen evaluates over a population. It exists so a screen mounts a rule *set* rather
 * than reaching into each rule family, and so the set a run used is a value the run can record.
 *
 * The numeric forensics are not re-implemented here — they wrap the already-tested `analyticsEngine`
 * checks (see `rules/numeric.ts`). This module only assembles the population-target families.
 */
import type { RuleTarget, SysteligonRule } from './types';
import { numericRules } from './rules/numeric';
import { justBelowThreshold } from './rules/threshold';
import { documentRules } from './rules/documents';
import { patternRules } from './rules/patterns';
import { sequentialRules } from './rules/sequential';
import { structuralRules } from './rules/structural';

/** The population-target rules the rule-run screen runs: the numeric forensics plus the
 *  just-below-threshold rule. All released; a draft never runs without an explicit ask. */
export const systeligonPopulationRules: SysteligonRule[] = [...numericRules, justBelowThreshold];

/**
 * Every shipped released rule, across every scope (spec §5). The rule base is not tied to population:
 * a rule declares its own target, and the run surface offers the scopes the shipped base covers.
 * Assembled here so a screen mounts one rule base rather than reaching into each family.
 */
export const systeligonRuleLibrary: SysteligonRule[] = [
  ...systeligonPopulationRules,
  ...documentRules,
  ...patternRules,
  ...sequentialRules,
  ...structuralRules,
];

/** The scopes the shipped rule base covers, in a stable order — what the run surface offers. */
export const systeligonScopes: RuleTarget[] = [
  ...new Set(systeligonRuleLibrary.map((r) => r.appliesTo)),
].sort();
