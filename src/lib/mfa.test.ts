import { describe, expect, it } from 'vitest';
import { mfaSatisfied, normaliseAssuranceLevel } from './mfa';

/** WP9: the platform second-factor decision, pure and total. */
describe('mfaSatisfied (WP9)', () => {
  it('is satisfied when no factor is required, whatever the level', () => {
    expect(mfaSatisfied(false, 'aal1')).toBe(true);
    expect(mfaSatisfied(false, 'aal2')).toBe(true);
  });

  it('requires AAL2 when the factor is required', () => {
    expect(mfaSatisfied(true, 'aal1')).toBe(false);
    expect(mfaSatisfied(true, 'aal2')).toBe(true);
  });
});

describe('normaliseAssuranceLevel (WP9)', () => {
  it('maps only aal2 to aal2 and everything else to aal1', () => {
    expect(normaliseAssuranceLevel('aal2')).toBe('aal2');
    expect(normaliseAssuranceLevel('aal1')).toBe('aal1');
    expect(normaliseAssuranceLevel(null)).toBe('aal1');
    expect(normaliseAssuranceLevel(undefined)).toBe('aal1');
    expect(normaliseAssuranceLevel('nonsense')).toBe('aal1');
  });
});
