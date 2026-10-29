/**
 * Systeligon rule packs (spec §4, S1). A pack is a named, versioned bundle of rules shipped per audit
 * type, so a new client gets a working rulebook on day one. Packs are values; the builder rejects a
 * malformed one at construction so a bad pack can never reach a run.
 */
import type { RulePack, RuleTarget, SysteligonRule } from './types';
import { RuleRegistry } from './versioning';

/** Build and validate a pack. Throws on a malformed rule or a duplicate `id@version`. */
export function definePack(name: string, version: number, target: RuleTarget, rules: SysteligonRule[]): RulePack {
  if (!name) throw new Error('A rule pack needs a name.');
  if (!Number.isInteger(version) || version < 1) throw new Error(`Pack ${name} has an invalid version.`);
  const registry = new RuleRegistry();
  registry.registerAll(rules);
  for (const rule of rules) {
    if (rule.appliesTo !== target) {
      throw new Error(`Pack ${name} targets ${target} but rule ${rule.id} applies to ${rule.appliesTo}.`);
    }
  }
  return { name, version, target, rules };
}

/** The rules a pack defines, released only. A run over a pack never executes a draft by default. */
export function releasedRules(pack: RulePack): SysteligonRule[] {
  return pack.rules.filter((r) => r.status === 'released');
}

/** Merge several packs into the flat rule set a run takes. Duplicate `id@version` collapses to one. */
export function packRules(packs: RulePack[]): SysteligonRule[] {
  const registry = new RuleRegistry();
  for (const pack of packs) registry.registerAll(pack.rules);
  return registry.history().map(({ id, version }) => registry.get(id, version) as SysteligonRule);
}
