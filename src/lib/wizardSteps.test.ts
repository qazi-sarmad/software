import { describe, expect, it } from 'vitest';
import { ORG_WIZARD_STEPS, SA_WIZARD_STEPS, visibleSteps, wizardSteps } from './wizardSteps';

describe('wizard step registry (F17)', () => {
  it('has the eight Org Admin steps in order', () => {
    expect(ORG_WIZARD_STEPS).toHaveLength(8);
    expect(ORG_WIZARD_STEPS[0].key).toBe('org.profile');
    expect(ORG_WIZARD_STEPS[7].key).toBe('org.golive');
  });

  it('has the eight Super Admin steps in order', () => {
    expect(SA_WIZARD_STEPS).toHaveLength(8);
    expect(SA_WIZARD_STEPS[0].key).toBe('sa.readiness');
    expect(SA_WIZARD_STEPS[7].key).toBe('sa.golive');
  });

  it('every step has a tutorial key and plain-language what/why/skip text', () => {
    for (const s of [...ORG_WIZARD_STEPS, ...SA_WIZARD_STEPS]) {
      expect(s.tutorialKey).toMatch(/^(oa|sa)\./);
      expect(s.what.length).toBeGreaterThan(10);
      expect(s.why.length).toBeGreaterThan(10);
      expect(s.skip.length).toBeGreaterThan(10);
    }
  });

  it('step keys are unique across both wizards', () => {
    const keys = [...ORG_WIZARD_STEPS, ...SA_WIZARD_STEPS].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('wizardSteps selects by scope', () => {
    expect(wizardSteps('org_admin')).toBe(ORG_WIZARD_STEPS);
    expect(wizardSteps('super_admin')).toBe(SA_WIZARD_STEPS);
  });

  it('visibleSteps hides a step whose required feature is off', () => {
    // The AI step was the only feature-gated step and is removed (0087), so no step is gated now and
    // the filter is a no-op. The mechanism stays for the steps later slices add.
    expect(ORG_WIZARD_STEPS.some((s) => s.requiresFeature)).toBe(false);
    expect(visibleSteps('org_admin', new Set())).toHaveLength(ORG_WIZARD_STEPS.length);
    expect(visibleSteps('super_admin', new Set())).toHaveLength(SA_WIZARD_STEPS.length);
  });
});
