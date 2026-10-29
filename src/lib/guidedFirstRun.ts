/**
 * Guided first run (U6; SYSTELIGON.md §11.1c Tier 2 item 7).
 *
 * "A new org's dashboard should not be a wall of zeros. It should say 'Create your first universe'
 * with one button." The decision of WHAT to show is a pure rule over three counts — universes,
 * entities, engagements — and the caller's rights. Nothing here reads the clock or the database, so
 * the guided state is deterministic and unit-testable, and the same counts always produce the same
 * guidance.
 *
 * Rights, not role names: the create steps are gated by the right they need (edit_config), so a
 * member who may not create sees the plain explanation, never a dead button.
 */
import type { Right } from './rights';
import { hasRight } from './rights';
import type { User } from '../types';

/** The counts the guidance is decided from. `get_org_data_state` (migration 0117) supplies them. */
export interface OrgCounts {
  universes: number;
  entities: number;
  engagements: number;
}

/** What a guided step does when its button is pressed. The caller wires it to the existing path. */
export type GuidedAction = 'create_universe' | 'add_entity' | 'open_setup';

/** One step of the guided first run. */
export interface GuidedStep {
  key: string;
  title: string;
  body: string;
  ctaLabel: string;
  action: GuidedAction;
  /** When set, the step is shown only to a caller who holds the right. */
  minRight?: Right;
  /** Whether the step's outcome already exists (its subject has at least one row). */
  done: boolean;
}

/**
 * Is this a brand-new organisation? The single rule: no universe yet. An org with a universe is
 * past first run, even if that universe has no entity, because creating a universe is the first
 * action that makes the product usable at all (add_entity and deploy_engagement both need one).
 */
export function isNewOrg(counts: OrgCounts): boolean {
  return counts.universes === 0;
}

/**
 * The guided steps, in order, with their completion state. Only the two countable first-run actions
 * are steps: a step whose subject already exists is marked `done` rather than hidden, so the guided
 * panel reads as progress, not as a checklist that silently empties. The setup wizard is a permanent
 * secondary affordance on the panel, not a step, so it never reads as permanently unfinished.
 */
export function guidedSteps(counts: OrgCounts): GuidedStep[] {
  return [
    {
      key: 'universe',
      title: 'Create your first universe',
      body: 'A universe is the group of auditable entities you review. Everything else — entities, plans, engagements — belongs to one.',
      ctaLabel: 'Create a universe',
      action: 'create_universe',
      minRight: 'edit_config',
      done: counts.universes > 0,
    },
    {
      key: 'entity',
      title: 'Add an entity to audit',
      body: 'An entity is one auditable thing — a department, a process or a subsidiary. It is what an engagement is opened against.',
      ctaLabel: 'Add an entity',
      action: 'add_entity',
      minRight: 'edit_config',
      done: counts.entities > 0,
    },
  ];
}

/** The steps a caller may actually act on: a step needing a right the caller lacks is not offered. */
export function visibleGuidedSteps(user: User, counts: OrgCounts): GuidedStep[] {
  return guidedSteps(counts).filter((s) => !s.minRight || hasRight(user, s.minRight));
}

/**
 * The single line the guided panel leads with, or `null` when the organisation is not new (then the
 * dashboard shows its ordinary content, not a first-run banner). It names the FIRST unfinished
 * action, so the guidance always points at one next step.
 */
export function firstRunHeadline(counts: OrgCounts): string | null {
  if (counts.universes === 0) return 'Create your first universe';
  if (counts.entities === 0) return 'Add your first entity to audit';
  return null;
}

/** The first unfinished, actionable step, or `null` when there is nothing left to guide. */
export function nextGuidedStep(user: User, counts: OrgCounts): GuidedStep | null {
  return visibleGuidedSteps(user, counts).find((s) => !s.done) ?? null;
}
