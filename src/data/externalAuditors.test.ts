import { describe, expect, it } from 'vitest';
import {
  getEngagementSummary,
  getLatestCertificate,
  getLatestPack,
  getMyAccess,
  inviteExternalAuditor,
  listExternalAccessLog,
  listExternalAuditors,
  listMyEngagements,
  revokeExternalAuditor,
  saveExternalAuditorGrants,
  verifyExternalCertificate,
} from './externalAuditors';

/**
 * With no Supabase environment variables the external auditor module is inert: every read returns
 * empty (or null) and every write reports that the module is not configured. No request leaves the
 * process.
 */
describe('external auditor data module (not configured)', () => {
  it('reads return empty or null', async () => {
    expect(await listExternalAuditors('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await listExternalAccessLog('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await listMyEngagements()).toEqual([]);
    expect(await getMyAccess()).toBeNull();
    expect(await getEngagementSummary('e1')).toBeNull();
    expect(await getLatestPack('e1')).toBeNull();
    expect(await getLatestCertificate('e1')).toBeNull();
    expect(await verifyExternalCertificate('c1')).toBeNull();
  });

  it('writes report not configured', async () => {
    const reason = 'The external auditor module is not configured.';
    expect(await inviteExternalAuditor({
      email: 'a@b.test', engagementIds: ['e1'], expiryKind: 'time_boxed', accessDays: 30,
    })).toEqual({ ok: false, reason });
    expect(await saveExternalAuditorGrants('a0000000-0000-0000-0000-000000000001', [])).toEqual({
      ok: false, reason,
    });
    expect(await revokeExternalAuditor('a0000000-0000-0000-0000-000000000001', 'u1')).toEqual({
      ok: false, reason,
    });
  });
});
