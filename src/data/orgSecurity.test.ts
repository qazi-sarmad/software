import { describe, expect, it } from 'vitest';
import { getOrgSecurityStatus, listOrgSecurityVersions, setRequireMfa } from './orgSecurity';

/**
 * With no Supabase environment variables the tenant-security module is inert: the posture reads as
 * "no second factor required", the history is empty, and the write reports not configured. No request
 * leaves the process. The refusal and ledger behaviour is proved against the real database in
 * supabase/tests/108_owner_only_console_tenant_mfa.sql.
 */
describe('org security data module (not configured)', () => {
  it('reports no posture when the module is inert', async () => {
    expect(await getOrgSecurityStatus()).toBeNull();
  });

  it('reads an empty history', async () => {
    expect(await listOrgSecurityVersions()).toEqual([]);
  });

  it('the write reports that the module is not configured', async () => {
    expect(await setRequireMfa(true, 'client policy: second factor for every member')).toEqual({
      ok: false,
      reason: 'The security module is not configured.',
    });
  });
});
