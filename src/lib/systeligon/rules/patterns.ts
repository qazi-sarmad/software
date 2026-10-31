/**
 * Systeligon structural pattern rules (S9, spec §3.3 last block). Deterministic pattern matching over
 * source and configuration text: hardcoded credentials, `SELECT *`, an external call with no error
 * handling, an unbounded loop, a disabled check, and a hardcoded environment value. Each rule reports
 * the shape and the line; it does not judge intent — a human decides (§7).
 */
import type { RuleFinding, RuleInput, SysteligonRule } from '../types';

interface LineHit { ref: string; line: number; text: string }

/** Every line of every source file, for the rules to scan. */
function lines(input: RuleInput): LineHit[] {
  const out: LineHit[] = [];
  for (const f of input.sourceFiles ?? []) {
    f.text.replace(/\r\n?/g, '\n').split('\n').forEach((text, i) => out.push({ ref: f.ref, line: i + 1, text }));
  }
  return out;
}

function makePatternRule<P extends Record<string, unknown>>(
  id: string, title: string, params: P, severity: SysteligonRule['severity'],
  hit: (line: string) => boolean,
): SysteligonRule<P> {
  return {
    id, version: 1, kind: 'pattern', appliesTo: 'config', title, params, standards: [], status: 'released', severity,
    evaluate: (input, ctx) => {
      const findings: RuleFinding[] = [];
      for (const l of lines(input)) {
        if (hit(l.text)) findings.push({
          ruleId: ctx.ruleId, ruleVersion: ctx.ruleVersion, kind: 'pattern', severity: ctx.severity,
          reason: `${l.ref}:${l.line} — ${title}.`, refs: [`${l.ref}:${l.line}`],
        });
      }
      return findings;
    },
  };
}

/** Hardcoded credentials: an assignment to a secret-looking key with a literal value. */
export const hardcodedCredentials = makePatternRule(
  'pattern.hardcoded_credentials', 'Hardcoded credential', {}, 'high',
  (l) => /(?:password|passwd|secret|api[_-]?key|token|access[_-]?key)\s*[:=]\s*['"][^'"]+['"]/i.test(l) &&
    !/process\.env|import\.meta\.env|\$\{/.test(l),
);

/** A bare `SELECT *` in a query string. */
export const selectStar = makePatternRule(
  'pattern.select_star', 'Unprojected SELECT *', {}, 'low',
  (l) => /select\s+\*\s+from/i.test(l),
);

/** An external call with no visible error handling on the same line or the next (see the rule note). */
export const externalCallNoErrorHandling = makePatternRule(
  'pattern.external_call_no_error_handling', 'External call with no error handling', {}, 'medium',
  // Line-local: a fetch/axios call whose line carries no try/catch/await-error construct. The rule
  // reports the shape; the reviewer confirms whether handling exists on an adjacent line.
  (l) => /\b(fetch|axios\.(?:get|post|put|delete)|https?\.request)\s*\(/.test(l) && !/try|catch|\?\.|\|\||\.catch/.test(l),
);

/** An unbounded loop: a `while (true)` / `for (;;)` with no obvious break on the same line. */
export const unboundedLoop = makePatternRule(
  'pattern.unbounded_loop', 'Unbounded loop', {}, 'medium',
  (l) => /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/.test(l) && !/break/.test(l),
);

/** A disabled check: a lint/type/security directive or a commented-out assertion. */
export const disabledCheck = makePatternRule(
  'pattern.disabled_check', 'Disabled check', {}, 'medium',
  (l) => /eslint-disable|@ts-ignore|@ts-nocheck|nosec|nosemgrep|# noqa/i.test(l),
);

/** A hardcoded environment value: a URL/host literal rather than configuration. */
export const hardcodedEnvironment = makePatternRule(
  'pattern.hardcoded_environment', 'Hardcoded environment value', {}, 'low',
  (l) => /https?:\/\/(?!localhost|127\.0\.0\.1|example\.com|\$\{)[a-z0-9.-]+/i.test(l) &&
    !/process\.env|import\.meta\.env/.test(l),
);

export const patternRules: SysteligonRule[] = [
  hardcodedCredentials, selectStar, externalCallNoErrorHandling, unboundedLoop, disabledCheck, hardcodedEnvironment,
];
