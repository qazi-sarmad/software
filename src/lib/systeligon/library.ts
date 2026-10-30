/**
 * The shipped Systeligon rule library (S6, spec §3.1). A named, versioned set of the released rules
 * the rule-run screen evaluates over a population. It exists so a screen mounts a rule *set* rather
 * than reaching into each rule family, and so the set a run used is a value the run can record.
 *
 * The numeric forensics are not re-implemented here — they wrap the already-tested `analyticsEngine`
 * checks (see `rules/numeric.ts`). This module only assembles the population-target families.
 */
import type { SysteligonRule } from './types';
import { numericRules } from './rules/numeric';
import { justBelowThreshold } from './rules/threshold';

/** The population-target rules the rule-run screen runs: the numeric forensics plus the
 *  just-below-threshold rule. All released; a draft never runs without an explicit ask. */
export const systeligonPopulationRules: SysteligonRule[] = [...numericRules, justBelowThreshold];
