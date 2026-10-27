import { describe, expect, it } from 'vitest';
import { getSsoSettings, listSsoProviders, setSsoProvider, signInWithSso, ssoOrgForDomain } from './sso';

/**
 * With no Supabase environment variables the SSO module is inert: reads return empty and the write
 * reports not configured. No request leaves the process. The token-hook enforcement is proved against
 * the real database in supabase/tests/107_sso_erasure.sql.
 */
describe('sso data module (not configured)', () => {
  it('reads return empty', async () => {
    expect(await listSsoProviders()).toEqual([]);
    expect(await getSsoSettings('org')).toBeNull();
    expect(await ssoOrgForDomain('example.com')).toBeNull();
  });

  it('the write reports that the SSO module is not configured', async () => {
    expect(await setSsoProvider('org', 'okta', 'example.com', true, 'client policy: enforce SSO')).toEqual({
      ok: false,
      reason: 'The SSO module is not configured.',
    });
  });

  it('the federated sign-in refuses when SSO is not configured', async () => {
    expect(await signInWithSso('example.com')).toEqual({ ok: false, reason: 'SSO is not configured.' });
  });
});
