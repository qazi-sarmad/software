/**
 * File ownership data module (owner instruction 2026-10-30): the file owner of an audit file, and
 * the permanently configurable custodian role of an archived file.
 *
 * Two invariants live behind this module (migrations 0202 and 0203):
 *   - no audit file exists or is sealed without a file owner;
 *   - an archived file has a custodian ROLE the organisation chooses, and that choice is never
 *     deleted.
 *
 * Reads use the org-scoped readers; every write goes through the RPCs, so the database decides the
 * right the caller needs (manage_engagements to name an owner, manage_roles to change the custodian).
 */
import { getClient } from './db';
import { listRoles } from './admin';

export interface CustodianRoleOption {
  slug: string;
  name: string;
  /** A short, plain description for the seeded roles; empty for a tenant's own role. */
  why: string;
}

/** A plain description for the roles every tenant is seeded with. */
const SEEDED_ROLE_WHY: Record<string, string> = {
  cia: 'The accountable head of the function. The platform default.',
  org_admin: 'The organisation administrator.',
  audit_manager: 'The manager accountable for the engagement.',
  reviewer: 'The independent reviewer.',
  preparer: 'The person who prepares the work.',
  observer: 'A read-only holder of the record.',
  auditee: 'The audited party.',
};

/**
 * The roles this organisation may choose as the custodian of an archived file. The options are the
 * organisation's REAL roles, read from the roles table, so an offered role is always one the
 * database will accept — never a hard-coded list that a refusal would contradict.
 */
export async function listCustodianRoles(): Promise<CustodianRoleOption[]> {
  const roles = await listRoles();
  return roles.map((r) => ({ slug: r.slug, name: r.name, why: SEEDED_ROLE_WHY[r.slug] ?? '' }));
}

export interface FileOwnerAuditRow {
  engagementId: string;
  title: string;
  universeName: string;
  stage: string;
  sealed: boolean;
  ownerUserId: string | null;
  ownerName: string;
  /** True when the file was given an owner by default or has none — the assignment needs confirming. */
  backfillRequired: boolean;
  version: number;
  assignedAt: string | null;
}

export interface ArchivedFileCustodianRow {
  archiveId: string;
  populationId: string;
  engagementId: string | null;
  status: string;
  contentHash: string;
  archivedRowCount: number;
  custodianRoleSlug: string;
  custodianRoleName: string;
  ownerUserId: string | null;
  ownerName: string;
  createdAt: string;
}

export interface ArchivedFileRole {
  roleSlug: string;
  roleName: string;
  isDefault: boolean;
  version: number;
  reason: string;
  updatedAt: string | null;
}

export async function listFileOwnerAudit(): Promise<FileOwnerAuditRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('engagement_owner_audit_list');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    engagementId: String(r.engagement_id),
    title: String(r.title ?? ''),
    universeName: String(r.universe_name ?? ''),
    stage: String(r.stage ?? ''),
    sealed: Boolean(r.sealed),
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    ownerName: String(r.owner_name ?? ''),
    backfillRequired: Boolean(r.backfill_required),
    version: Number(r.version ?? 0),
    assignedAt: (r.assigned_at as string | null) ?? null,
  }));
}

export async function getArchivedFileRole(): Promise<ArchivedFileRole | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('archived_file_role_get');
  if (error) throw new Error(error.message);
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;
  return {
    roleSlug: String(row.role_slug ?? ''),
    roleName: String(row.role_name ?? ''),
    isDefault: Boolean(row.is_default),
    version: Number(row.version ?? 1),
    reason: String(row.reason ?? ''),
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

export async function setArchivedFileRole(roleSlug: string, reason: string): Promise<number | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('archived_file_role_set', {
    p_role_slug: roleSlug, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data === null || data === undefined ? null : Number(data);
}

export async function listArchivedFileCustodians(): Promise<ArchivedFileCustodianRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('archived_file_custodians');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    archiveId: String(r.archive_id),
    populationId: String(r.population_id),
    engagementId: (r.engagement_id as string | null) ?? null,
    status: String(r.status ?? ''),
    contentHash: String(r.content_hash ?? ''),
    archivedRowCount: Number(r.archived_row_count ?? 0),
    custodianRoleSlug: String(r.custodian_role_slug ?? ''),
    custodianRoleName: String(r.custodian_role_name ?? ''),
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    ownerName: String(r.owner_name ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));
}
