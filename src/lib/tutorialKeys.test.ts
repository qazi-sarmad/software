import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TUTORIAL_KEYS, TUTORIAL_KEY_NAMES } from './tutorialKeys';

describe('tutorial key registry (F18, S12)', () => {
  it('has a key for every entry and no duplicates', () => {
    expect(TUTORIAL_KEYS.length).toBeGreaterThanOrEqual(77);
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

  it('gives every key at least four real steps', () => {
    for (const def of TUTORIAL_KEYS) {
      expect(def.steps.length, `${def.key} has ${def.steps.length} steps`).toBeGreaterThanOrEqual(4);
      for (const step of def.steps) {
        expect(step.text.trim().length, `${def.key} has an empty step`).toBeGreaterThan(0);
      }
    }
  });

  it('never uses a generic filler phrase', () => {
    const banned = [
      'follow the highlighted control',
      'click here',
      'do the thing',
      'as needed',
      'and so on',
    ];
    for (const def of TUTORIAL_KEYS) {
      for (const step of def.steps) {
        const lower = step.text.toLowerCase();
        for (const phrase of banned) {
          expect(lower.includes(phrase), `${def.key} uses the filler phrase "${phrase}"`).toBe(false);
        }
      }
    }
  });

  it('points every step target at a testid the UI contract lists', () => {
    const contract = readFileSync(resolve(process.cwd(), 'docs/ACP-UI-CONTRACT.md'), 'utf8');
    const documented = [...contract.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1])
      .filter((t) => t.includes('-') && !/\s/.test(t));
    // A contract entry with a `<...>` placeholder covers any concrete id that fits it, so a step may
    // target `super_admin-wizard-show-sa.readiness` where the contract documents
    // `<scope>-wizard-show-<stepKey>` and names the same id as an example.
    const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const covered = (testid: string): boolean =>
      documented.some((token) => {
        if (token === testid) return true;
        if (!token.includes('<')) return false;
        const source = token.split(/<[^>]*>/).map(escape).join('[a-z0-9._-]+');
        return new RegExp(`^${source}$`).test(testid);
      });
    for (const def of TUTORIAL_KEYS) {
      for (const step of def.steps) {
        if (!step.testid) continue;
        expect(
          covered(step.testid),
          `${def.key} targets ${step.testid}, which docs/ACP-UI-CONTRACT.md does not list`,
        ).toBe(true);
      }
    }
  });

  it('covers the Appendix A setup steps of both wizards', () => {
    // Eight steps each: the AI step was the fourth and is removed (0087), so the keys run 1..8.
    for (let i = 1; i <= 8; i++) {
      expect(TUTORIAL_KEY_NAMES).toContain(`oa.setup-${i}`);
      expect(TUTORIAL_KEY_NAMES).toContain(`sa.setup-${i}`);
    }
    expect(TUTORIAL_KEY_NAMES).not.toContain('oa.setup-9');
    expect(TUTORIAL_KEY_NAMES).not.toContain('sa.setup-9');
  });
});
