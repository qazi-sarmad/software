/**
 * Systeligon rule runner (spec §4, S1).
 *
 * Deterministic and total: `runRules` is a pure function of the input, the rule set and the context.
 * It runs every rule whose `appliesTo` matches the input, skips `draft` rules unless the caller asks
 * for them, records exactly what ran (id + version) so a sealed report can be re-derived, and sorts
 * findings into a stable order so two runs of the same input produce byte-identical output.
 *
 * One rule that throws must not take the run down: the failure is turned into a finding against the
 * rule's own identity, because silence about a rule that did not run would be the same class of lie
 * as an unparsed clause reported as clean (spec §3.3).
 */
import type {
  RuleFinding, RuleInput, RulePack, RuleRef, RuleRunResult, RuleTarget, SysteligonRule,
} from './types';

export interface RunOptions {
  /** ISO timestamp; required because the engine never reads a clock. */
  evaluatedAt: string;
  /** When true, `draft` rules run too. Default false: a pack ships drafts and a human releases them. */
  includeDrafts?: boolean;
  /** Only run rules for this target. Default: the target of each rule is honoured as-is. */
  target?: RuleTarget;
}

/** A stable, deterministic order: by rule id, then version, then the first ref, then reason. */
function sortFindings(findings: RuleFinding[]): RuleFinding[] {
  return [...findings].sort(
    (a, b) =>
      a.ruleId.localeCompare(b.ruleId) ||
      a.ruleVersion - b.ruleVersion ||
      (a.refs[0] ?? '').localeCompare(b.refs[0] ?? '') ||
      a.reason.localeCompare(b.reason),
  );
}

/** Structural validation of a rule. Throws on a malformed rule rather than running it blind. */
export function assertValidRule(rule: SysteligonRule): void {
  if (!rule.id || typeof rule.id !== 'string') throw new Error('Rule is missing an id.');
  if (!Number.isInteger(rule.version) || rule.version < 1) throw new Error(`Rule ${rule.id} has an invalid version.`);
  if (!rule.appliesTo) throw new Error(`Rule ${rule.id} does not declare appliesTo.`);
  if (!rule.kind) throw new Error(`Rule ${rule.id} does not declare a kind.`);
  if (typeof rule.evaluate !== 'function') throw new Error(`Rule ${rule.id} has no evaluate function.`);
}

/** Validate every rule in a pack before any of them runs. */
export function assertValidPack(pack: RulePack): void {
  const seen = new Set<string>();
  for (const rule of pack.rules) {
    assertValidRule(rule);
    const key = `${rule.id}@${rule.version}`;
    if (seen.has(key)) throw new Error(`Rule pack ${pack.name} contains a duplicate ${key}.`);
    seen.add(key);
  }
}

function makeFinding(rule: SysteligonRule, scope: RuleTarget | undefined, reason: string, refs: string[]): RuleFinding {
  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    kind: rule.kind,
    severity: rule.severity,
    scope: scope ?? rule.appliesTo,
    reason,
    refs: [...refs].sort(),
  };
}

/**
 * Run every applicable rule over the input. `rules` may be one pack or any set; duplicate
 * (id, version) pairs across packs are collapsed, so the same rule shipped twice runs once.
 */
export function runRules(rules: SysteligonRule[], input: RuleInput, options: RunOptions): RuleRunResult {
  const { evaluatedAt, includeDrafts = false, target } = options;
  const findings: RuleFinding[] = [];
  const ran: RuleRef[] = [];
  const skipped: RuleRef[] = [];
  const run = new Set<string>();

  for (const rule of rules) {
    const ref: RuleRef = { id: rule.id, version: rule.version };
    if (run.has(`${rule.id}@${rule.version}`)) continue;
    if (!includeDrafts && rule.status === 'draft') {
      skipped.push(ref);
      continue;
    }
    if (target && rule.appliesTo !== target) continue;
    run.add(`${rule.id}@${rule.version}`);
    ran.push(ref);
    // The scope is the run's target when one was given, else the rule's own — sealed with the
    // finding so a population finding and a document finding can never be conflated.
    const scope = target ?? rule.appliesTo;
    try {
      const ctx = { ruleId: rule.id, ruleVersion: rule.version, severity: rule.severity, evaluatedAt };
      for (const f of rule.evaluate(input, ctx)) {
        // Re-stamp provenance from the rule so a rule cannot misreport its own identity or version.
        findings.push({ ...f, ruleId: rule.id, ruleVersion: rule.version, kind: rule.kind, severity: rule.severity, scope });
      }
    } catch (e) {
      findings.push(makeFinding(rule, scope, `Rule ${rule.id} failed to run: ${e instanceof Error ? e.message : String(e)}`, []));
    }
  }

  return { findings: sortFindings(findings), ran, skipped, evaluatedAt };
}
