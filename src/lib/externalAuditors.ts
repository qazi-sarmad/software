/**
 * External auditor portal model (F13, S9).
 *
 * Pure functions only: no database client, no DOM. The portal is read-only; these helpers shape the
 * grant list, decide what an auditor may do, and format the invite expiry in plain words.
 * Deterministic throughout (L1): no randomness, no AI.
 */

export type GrantPermission =
  | 'view_summary'
  | 'download_pack'
  | 'download_certificate'
  | 'verify';

export const GRANT_PERMISSIONS: { key: GrantPermission; label: string }[] = [
  { key: 'view_summary', label: 'View engagement summary' },
  { key: 'download_pack', label: 'Download Board Pack' },
  { key: 'download_certificate', label: 'Download certificate' },
  { key: 'verify', label: 'Verify a hash' },
];

export type ExpiryKind = 'time_boxed' | 'permanent';

export interface ExternalAuditorGrant {
  userId: string;
  email: string;
  active: boolean;
  engagementId: string | null;
  title: string | null;
  canViewSummary: boolean;
  canDownloadPack: boolean;
  canDownloadCertificate: boolean;
  canVerify: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ExternalAccessEntry {
  id: string;
  userId: string | null;
  engagementId: string | null;
  functionName: string;
  outcome: string;
  detail: Record<string, unknown>;
  ts: string;
}

export interface AuditorEngagement {
  engagementId: string;
  title: string;
  orgName: string;
  canDownloadPack: boolean;
  canDownloadCertificate: boolean;
  expiresAt: string | null;
}

/** Is a grant live at p_now (not revoked, not expired)? */
export function grantIsLive(grant: ExternalAuditorGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt) return false;
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

/** The permissions a single grant carries, in the catalogue order. */
export function permissionsOf(grant: ExternalAuditorGrant): GrantPermission[] {
  const out: GrantPermission[] = [];
  if (grant.canViewSummary) out.push('view_summary');
  if (grant.canDownloadPack) out.push('download_pack');
  if (grant.canDownloadCertificate) out.push('download_certificate');
  if (grant.canVerify) out.push('verify');
  return out;
}

/**
 * The permission matrix for the OA-14 screen: rows are auditors, columns are permissions, and each
 * cell is the union of that auditor's live grants across the named engagements. Deterministic.
 */
export function permissionMatrix(
  grants: ExternalAuditorGrant[]
): { userId: string; email: string; active: boolean; permissions: Record<GrantPermission, boolean> }[] {
  const byUser = new Map<string, { email: string; active: boolean; permissions: Record<GrantPermission, boolean> }>();
  for (const g of grants) {
    const live = grantIsLive(g);
    const entry = byUser.get(g.userId) ?? {
      email: g.email,
      active: g.active,
      permissions: { view_summary: false, download_pack: false, download_certificate: false, verify: false },
    };
    if (live) {
      entry.permissions.view_summary ||= g.canViewSummary;
      entry.permissions.download_pack ||= g.canDownloadPack;
      entry.permissions.download_certificate ||= g.canDownloadCertificate;
      entry.permissions.verify ||= g.canVerify;
    }
    byUser.set(g.userId, entry);
  }
  return [...byUser.entries()]
    .map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** The engagement ids an invite names, de-duplicated and in a stable order. */
export function normaliseEngagementIds(ids: string[] | null | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))].sort();
}

/** The expiry instant for an invite: null when permanent, else now + accessDays. */
export function inviteExpiry(kind: ExpiryKind, accessDays: number, from: Date = new Date()): Date | null {
  if (kind === 'permanent') return null;
  const days = Number.isFinite(accessDays) ? Math.max(1, Math.min(365, Math.trunc(accessDays))) : 30;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** A plain-words summary of when access ends, for the OA-14 list and the invite wizard. */
export function describeExpiry(grant: ExternalAuditorGrant, now: Date = new Date()): string {
  if (grant.revokedAt) return 'Revoked';
  if (!grant.expiresAt) return 'Permanent access';
  const ms = new Date(grant.expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'Expired';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `Ends in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.floor(ms / (60 * 60 * 1000)));
  return `Ends in ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** The route an external auditor is sent to after accepting an invite. */
export function portalHomePath(): string {
  return '/external';
}

/** The plain-words hint shown when the owner has not enabled signups (F13 wizard). */
export const SIGNUP_DISABLED_HINT =
  'External auditor accounts need sign-ups enabled in Supabase Auth. Ask your platform owner to '
  + 'turn sign-ups on if this message appears.';
