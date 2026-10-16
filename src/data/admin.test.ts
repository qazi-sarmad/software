import { describe, expect, it } from 'vitest';
import {
  createRole,
  deleteRole,
  grantScope,
  listMembers,
  listRoles,
  listScopes,
  provisionMember,
  revokeScope,
  setInviteCap,
  setMemberManager,
  setMemberRole,
  updateRoleRights,
} from './admin';

/**
 * With no Supabase environment variables the administration module is inert: reads return empty
 * and writes report that administration is not configured. No request leaves the process.
 */
describe('admin data module (not configured)', () => {
  it('reads return empty collections', async () => {
    expect(await listMembers()).toEqual([]);
    expect(await listRoles()).toEqual([]);
    expect(await listScopes()).toEqual([]);
  });

  it('writes report that administration is not configured', async () => {
    const notConfigured = { ok: false, reason: 'Administration is not configured.' };
    expect(await provisionMember('u', 'N', 'cia')).toEqual(notConfigured);
    expect(await setMemberRole('u', 'cia')).toEqual(notConfigured);
    expect(await setMemberManager('u', null)).toEqual(notConfigured);
    expect(await grantScope('u', null, null, null)).toEqual(notConfigured);
    expect(await revokeScope('s')).toEqual(notConfigured);
    expect(await createRole('N', 'n', {})).toEqual(notConfigured);
    expect(await updateRoleRights('cia', {})).toEqual(notConfigured);
    expect(await deleteRole('n')).toEqual(notConfigured);
    expect(await setInviteCap(5)).toEqual(notConfigured);
  });
});
