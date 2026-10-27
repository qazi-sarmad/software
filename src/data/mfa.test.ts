import { describe, expect, it } from 'vitest';
import { currentAssuranceLevel, enrollTotp, listMfaFactors, unenrollTotp, verifyTotp } from './mfa';

/**
 * With no Supabase environment variables the MFA module is inert: reads report the lowest assurance
 * level and no factors, and every enrolment action refuses rather than silently succeeding. No
 * request leaves the process. The real TOTP round-trip is Supabase Auth's, exercised in the browser.
 */
describe('mfa data module (not configured)', () => {
  it('reports no factors and the lowest assurance level', async () => {
    expect(await listMfaFactors()).toEqual([]);
    expect(await currentAssuranceLevel()).toBe('aal1');
  });

  it('refuses to enrol, verify or unenrol', async () => {
    await expect(enrollTotp('console')).rejects.toThrow('Multi-factor authentication is not configured.');
    await expect(verifyTotp('factor', '123456')).rejects.toThrow('Multi-factor authentication is not configured.');
    await expect(unenrollTotp('factor')).rejects.toThrow('Multi-factor authentication is not configured.');
  });
});
