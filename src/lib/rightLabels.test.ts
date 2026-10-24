import { describe, expect, it } from 'vitest';
import { rightReason, rightReasonFor } from './rightLabels';
import { RIGHTS } from './rights';

describe('rightReason (D14)', () => {
  it('has a plain-language reason for every right', () => {
    for (const right of RIGHTS) {
      const reason = rightReason(right);
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('never leaks the right slug in the reason text', () => {
    for (const right of RIGHTS) {
      expect(rightReason(right)).not.toContain(right);
      expect(rightReason(right)).not.toMatch(/_[a-z]/);
    }
  });

  it('rightReasonFor maps a known slug and falls back safely for an unknown one', () => {
    expect(rightReasonFor('perform_work')).toBe(rightReason('perform_work'));
    expect(rightReasonFor('not_a_right')).toBe("You don't have permission for this action");
    expect(rightReasonFor(null)).toBe("You don't have permission for this action");
    expect(rightReasonFor(undefined)).toBe("You don't have permission for this action");
  });
});
