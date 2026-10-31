/**
 * The discipline rule base (D11, docs/AUDIT-DOMAINS-MODEL.md §4). A discipline maps to the rules the
 * engine runs for it: management to the shipped library (numeric/structural/pattern/sequential), IT to
 * the IT control rules, Shari'ah to the AAOIFI/SBP structural rules. This module is the ONE place a
 * discipline is turned into a rule set, so the run surface and the domain screen cannot drift.
 *
 * Pure (L4): a function of its argument; no clock, no client, no model.
 */
import type { Discipline } from '../risk/domains';
import { systeligonRuleLibrary } from './library';
import { itRules, shariahRules, type DisciplineRule } from './rules/disciplines';
import type { SysteligonRule } from './types';

/** The executable rules for a discipline. `cross` carries no rules of its own (a tag, not a base). */
export function rulesForDiscipline(d: Discipline): SysteligonRule[] {
  switch (d) {
    case 'management': return systeligonRuleLibrary;
    case 'it': return itRules;
    case 'shariah': return shariahRules;
    case 'cross': return [];
  }
}

/** A short, honest summary of a discipline's rule base, for a screen to render. */
export interface DisciplineRuleBaseSummary {
  discipline: Discipline;
  /** The number of released rules the discipline runs. */
  ruleCount: number;
  /** The rule ids, in the base's own order. */
  ruleIds: string[];
  /** Every distinct standard/control id the rules cite, so a reviewer sees the sources. */
  standards: string[];
}

/** Summarise a discipline's rule base. The counts are read from the base, never asserted by hand. */
export function disciplineRuleBase(d: Discipline): DisciplineRuleBaseSummary {
  const rules = rulesForDiscipline(d) as DisciplineRule[];
  const standards = [...new Set(rules.flatMap((r) => r.standards ?? []))].sort();
  return { discipline: d, ruleCount: rules.length, ruleIds: rules.map((r) => r.id), standards };
}
