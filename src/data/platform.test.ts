import { describe, expect, it } from 'vitest';
import {
  enableAi, grantSupportAccess, listTenants, listTrail, revokeSupportAccess,
  setFeatureFlag, setInviteCap, setTenantStatus,
} from './platform';

/**
 * With no Supabase environment variables the platform module is inert: reads return empty and
 * writes report that the module is not configured. No request leaves the process.
 */
describe('platform data module (not configured)', () => {
  const notConfigured = { ok: false, reason: 'The platform module is not configured.' };

  it('reads return empty collections', async () => {
    expect(await listTenants()).toEqual([]);
    expect(await listTrail()).toEqual([]);
  });

  it('writes report that the platform module is not configured', async () => {
    expect(await setTenantStatus('org', 'suspended')).toEqual(notConfigured);
    expect(await setFeatureFlag('org', 'exports', true)).toEqual(notConfigured);
    expect(await enableAi('org', true, 'http://ai')).toEqual(notConfigured);
    expect(await setInviteCap('org', 5)).toEqual(notConfigured);
    expect(await grantSupportAccess('org', {}, 4)).toEqual(notConfigured);
    expect(await revokeSupportAccess('grant', 'a long enough reason')).toEqual(notConfigured);
  });
});
