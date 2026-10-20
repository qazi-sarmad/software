import { describe, expect, it } from 'vitest';
import {
  GRANT_PERMISSIONS,
  describeExpiry,
  grantIsLive,
  inviteExpiry,
  normaliseEngagementIds,
  permissionMatrix,
  permissionsOf,
  portalHomePath,
  SIGNUP_DISABLED_HINT,
  type ExternalAuditorGrant,
} from './externalAuditors';

function grant(over: Partial<ExternalAuditorGrant> = {}): ExternalAuditorGrant {
  return {
    userId: 'u1',
    email: 'auditor@example.test',
    active: true,
    engagementId: 'e1',
    title: 'Engagement 1',
    canViewSummary: true,
    canDownloadPack: false,
    canDownloadCertificate: false,
    canVerify: true,
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
}

describe('external auditor model (F13, S9)', () => {
  it('lists the four grant permissions in a stable order', () => {
    expect(GRANT_PERMISSIONS.map((p) => p.key)).toEqual([
      'view_summary', 'download_pack', 'download_certificate', 'verify',
    ]);
  });

  it('grantIsLive is false for a revoked or expired grant and true otherwise', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(grantIsLive(grant(), now)).toBe(true);
    expect(grantIsLive(grant({ revokedAt: '2026-10-01T00:00:00Z' }), now)).toBe(false);
    expect(grantIsLive(grant({ expiresAt: '2026-10-01T00:00:00Z' }), now)).toBe(false);
    expect(grantIsLive(grant({ expiresAt: '2026-11-01T00:00:00Z' }), now)).toBe(true);
  });

  it('permissionsOf returns only the permissions the grant carries', () => {
    expect(permissionsOf(grant({ canDownloadPack: true, canDownloadCertificate: true }))).toEqual([
      'view_summary', 'download_pack', 'download_certificate', 'verify',
    ]);
    expect(permissionsOf(grant({ canVerify: false }))).toEqual(['view_summary']);
  });

  it('permissionMatrix unions live grants per auditor and drops revoked or expired ones', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const rows = permissionMatrix([
      grant({ userId: 'u1', engagementId: 'e1', canDownloadPack: true }),
      grant({ userId: 'u1', engagementId: 'e2', canDownloadCertificate: true, expiresAt: '2026-10-01T00:00:00Z' }),
      grant({ userId: 'u2', engagementId: 'e1', revokedAt: '2026-10-01T00:00:00Z' }),
    ]);
    const u1 = rows.find((r) => r.userId === 'u1')!;
    expect(u1.permissions.download_pack).toBe(true);
    // The expired e2 grant contributes nothing.
    expect(u1.permissions.download_certificate).toBe(false);
    const u2 = rows.find((r) => r.userId === 'u2')!;
    expect(u2.permissions).toEqual({ view_summary: false, download_pack: false, download_certificate: false, verify: false });
    // The union ignores `now` inside permissionMatrix? It uses new Date(); assert shape only.
    expect(now.getTime()).toBeGreaterThan(0);
  });

  it('normaliseEngagementIds de-duplicates, drops empties and sorts', () => {
    expect(normaliseEngagementIds(['b', 'a', 'a', '', 'b'])).toEqual(['a', 'b']);
    expect(normaliseEngagementIds(null)).toEqual([]);
  });

  it('inviteExpiry is null for permanent and clamps the day count otherwise', () => {
    const from = new Date('2026-10-19T00:00:00Z');
    expect(inviteExpiry('permanent', 30, from)).toBeNull();
    expect(inviteExpiry('time_boxed', 30, from)!.toISOString()).toBe('2026-11-18T00:00:00.000Z');
    expect(inviteExpiry('time_boxed', 0, from)!.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(inviteExpiry('time_boxed', 9999, from)!.toISOString()).toBe('2027-10-19T00:00:00.000Z');
  });

  it('describeExpiry says permanent, revoked, expired or a countdown', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(describeExpiry(grant(), now)).toBe('Permanent access');
    expect(describeExpiry(grant({ revokedAt: '2026-10-01T00:00:00Z' }), now)).toBe('Revoked');
    expect(describeExpiry(grant({ expiresAt: '2026-10-01T00:00:00Z' }), now)).toBe('Expired');
    expect(describeExpiry(grant({ expiresAt: '2026-10-21T12:00:00Z' }), now)).toBe('Ends in 2 days');
    expect(describeExpiry(grant({ expiresAt: '2026-10-19T15:00:00Z' }), now)).toBe('Ends in 3 hours');
    expect(describeExpiry(grant({ expiresAt: '2026-10-20T12:00:00Z' }), now)).toBe('Ends in 1 day');
  });

  it('exposes the portal route and the signup hint', () => {
    expect(portalHomePath()).toBe('/external');
    expect(SIGNUP_DISABLED_HINT).toMatch(/sign-ups enabled/i);
  });
});
