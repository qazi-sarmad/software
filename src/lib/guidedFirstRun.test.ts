import { describe, expect, it } from 'vitest';
import {
  firstRunHeadline,
  guidedSteps,
  isNewOrg,
  nextGuidedStep,
  visibleGuidedSteps,
  type OrgCounts,
} from './guidedFirstRun';
import { testUser } from '../test/testUsers';
import type { User } from '../types';

const counts = (over: Partial<OrgCounts> = {}): OrgCounts => ({
  universes: 0,
  entities: 0,
  engagements: 0,
  ...over,
});

/** A user holding exactly the given rights (every decision reads rights, never role names).
 *  Based on the auditee, which holds no edit_config, so `userWith()` is a plain read-only member. */
const userWith = (...rights: string[]): User => ({
  ...testUser('auditee'),
  rights: Object.fromEntries(rights.map((r) => [r, true])),
});

describe('guidedFirstRun (U6)', () => {
  describe('isNewOrg', () => {
    it('is true only when there is no universe yet', () => {
      expect(isNewOrg(counts())).toBe(true);
      expect(isNewOrg(counts({ universes: 1 }))).toBe(false);
    });

    it('is past first run as soon as a universe exists, even with no entity', () => {
      expect(isNewOrg(counts({ universes: 1, entities: 0, engagements: 0 }))).toBe(false);
    });
  });

  describe('firstRunHeadline', () => {
    it('names the first unfinished action', () => {
      expect(firstRunHeadline(counts())).toBe('Create your first universe');
      expect(firstRunHeadline(counts({ universes: 1 }))).toBe('Add your first entity to audit');
    });

    it('is null once the organisation has a universe and an entity', () => {
      expect(firstRunHeadline(counts({ universes: 1, entities: 2 }))).toBeNull();
    });
  });

  describe('guidedSteps', () => {
    it('marks a step done from the count, and never hides a done step', () => {
      const steps = guidedSteps(counts({ universes: 1, entities: 0 }));
      expect(steps.map((s) => s.key)).toEqual(['universe', 'entity']);
      expect(steps.find((s) => s.key === 'universe')?.done).toBe(true);
      expect(steps.find((s) => s.key === 'entity')?.done).toBe(false);
    });

    it('is deterministic: same counts, same steps', () => {
      expect(guidedSteps(counts({ universes: 1 }))).toEqual(guidedSteps(counts({ universes: 1 })));
    });
  });

  describe('visibleGuidedSteps / nextGuidedStep', () => {
    it('offers the create step to a caller holding edit_config', () => {
      const steps = visibleGuidedSteps(userWith('edit_config'), counts());
      expect(steps.map((s) => s.key)).toContain('universe');
    });

    it('withholds the create steps from a caller without edit_config', () => {
      const steps = visibleGuidedSteps(userWith('view_all_scopes'), counts());
      expect(steps).toEqual([]);
    });

    it('points at the first unfinished, actionable step', () => {
      expect(nextGuidedStep(userWith('edit_config'), counts())?.action).toBe('create_universe');
      expect(nextGuidedStep(userWith('edit_config'), counts({ universes: 1 }))?.action).toBe('add_entity');
    });

    it('returns null when nothing is left to guide', () => {
      expect(nextGuidedStep(userWith('edit_config'), counts({ universes: 1, entities: 1 }))).toBeNull();
    });

    it('never offers an action the caller cannot take', () => {
      // A member with no edit_config cannot create; the guided panel points at no dead button, so
      // its primary action falls through to the setup wizard (the panel's secondary affordance).
      expect(nextGuidedStep(userWith(), counts())).toBeNull();
    });
  });
});
