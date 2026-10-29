/**
 * Systeligon — the deterministic forensic rule engine (spec §4). Public surface.
 *
 * S1 provides the shell: the rule/definition vocabulary, the pure runner, append-only versioning, and
 * rule packs. The rule library (S6), extraction tiers (S7), the flows (S3/S4/S5/S12) and signed OTA
 * distribution (S10/S11) build on this and are not part of S1.
 */
export type {
  RuleKind, RuleTarget, RuleSeverity, RuleStatus, RuleRef,
  SysteligonRule, RuleInput, RuleContext, RuleFinding, RuleRunResult, RulePack,
  DocumentElement, ParsedDocument,
} from './types';
export { runRules, assertValidRule, assertValidPack, type RunOptions } from './runner';
export { RuleRegistry, ruleFingerprint, type RuleVersionRecord } from './versioning';
export { definePack, releasedRules, packRules } from './packs';
export { structuralRules, minutesRequiredElements, policyCoverage } from './rules/structural';
