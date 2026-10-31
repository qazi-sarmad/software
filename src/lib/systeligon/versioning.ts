/**
 * Systeligon rule versioning (spec §4, §8). Rules are append-only and versioned: a change to a rule's
 * behaviour is a new version, never an edit in place, so a sealed output can always be re-derived from
 * the versions it recorded. This module is the registry that enforces that — it will not hold two
 * different definitions under the same `id@version`.
 *
 * Pure. No I/O. The registry is an in-memory value; persistence is a later work package.
 */
import type { RuleRef, RuleStatus, SysteligonRule } from './types';
import { assertValidRule } from './runner';

export interface RuleVersionRecord {
  id: string;
  version: number;
  status: RuleStatus;
  /** A stable fingerprint of the rule's definition. Two rules with one id@version must share it. */
  fingerprint: string;
}

/**
 * A fingerprint of everything that can change a finding: kind, target, severity, params, and the
 * stringified evaluator. Deliberately excludes `status`, because releasing a draft to a released rule
 * is a lifecycle change, not a behavioural one — the findings must be identical.
 */
export function ruleFingerprint(rule: SysteligonRule): string {
  const material = JSON.stringify({
    kind: rule.kind,
    appliesTo: rule.appliesTo,
    severity: rule.severity,
    params: rule.params,
    fn: rule.evaluate.toString(),
  });
  // djb2 — a cheap stable hash. Not a security primitive; only here to detect accidental drift.
  let h = 5381;
  for (let i = 0; i < material.length; i++) h = ((h << 5) + h + material.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export class RuleRegistry {
  private readonly byIdVersion = new Map<string, { rule: SysteligonRule; fingerprint: string }>();
  /** The highest version seen per id, so a lower version cannot be registered after a higher one. */
  private readonly latest = new Map<string, number>();

  private static key(id: string, version: number): string {
    return `${id}@${version}`;
  }

  /**
   * Register a rule version. Throws — never silently replaces — when:
   * a later version of the same id already exists (you cannot backfill an older version), or
   * the same id@version is registered with a different definition (append-only violated).
   */
  register(rule: SysteligonRule): void {
    assertValidRule(rule);
    const key = RuleRegistry.key(rule.id, rule.version);
    const fingerprint = ruleFingerprint(rule);
    const existing = this.byIdVersion.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(`Rule ${key} already exists with a different definition. Bump the version.`);
      }
      return;
    }
    const latest = this.latest.get(rule.id) ?? 0;
    if (rule.version < latest) {
      throw new Error(`Rule ${rule.id} version ${rule.version} is older than the registered version ${latest}.`);
    }
    this.byIdVersion.set(key, { rule, fingerprint });
    this.latest.set(rule.id, Math.max(latest, rule.version));
  }

  /** Register every rule in a set, failing the whole batch if any one is invalid. */
  registerAll(rules: SysteligonRule[]): void {
    for (const rule of rules) this.register(rule);
  }

  get(id: string, version: number): SysteligonRule | undefined {
    return this.byIdVersion.get(RuleRegistry.key(id, version))?.rule;
  }

  /** The latest registered version of a rule id, or undefined. */
  latestOf(id: string): SysteligonRule | undefined {
    const v = this.latest.get(id);
    return v === undefined ? undefined : this.get(id, v);
  }

  /** Every rule version held, sorted by id then version — the full append-only history. */
  history(): RuleVersionRecord[] {
    return [...this.byIdVersion.entries()]
      .map(([key, { rule }]) => {
        const [id, version] = key.split('@');
        return { id, version: Number(version), status: rule.status, fingerprint: ruleFingerprint(rule) };
      })
      .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  }

  /** Every rule version, as refs, for recording in a sealed report. */
  refs(): RuleRef[] {
    return this.history().map(({ id, version }) => ({ id, version }));
  }
}
