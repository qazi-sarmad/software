import { describe, expect, it } from 'vitest';
import { TUTORIAL_KEYS, TUTORIAL_KEY_NAMES } from './tutorialKeys';

describe('tutorial key registry (F18, S12)', () => {
  it('has a key for every entry and no duplicates', () => {
    expect(TUTORIAL_KEYS.length).toBeGreaterThan(80);
    expect(new Set(TUTORIAL_KEY_NAMES).size).toBe(TUTORIAL_KEY_NAMES.length);
  });

  it('gives every key an audience, a screen id and a title', () => {
    for (const def of TUTORIAL_KEYS) {
      expect(def.key).toMatch(/^(sa|oa|ex)\./);
      expect(['super_admin', 'org_admin', 'both']).toContain(def.audience);
      expect(def.screenId).toMatch(/^(GL|SA|OA|WK|EX|TUT)-/);
      expect(def.title.length).toBeGreaterThan(0);
    }
  });

  it('covers the Appendix A setup steps of both wizards', () => {
    for (let i = 1; i <= 9; i++) {
      expect(TUTORIAL_KEY_NAMES).toContain(`oa.setup-${i}`);
      expect(TUTORIAL_KEY_NAMES).toContain(`sa.setup-${i}`);
    }
  });
});
