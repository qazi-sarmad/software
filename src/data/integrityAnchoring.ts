/**
 * Integrity-anchoring administration data module (Phase 3.5, item A, §17).
 *
 * The only place the Super Admin integrity screen talks to the database. It wraps the 0096 RPCs:
 * the timestamp authority catalogue (RFC 3161 servers), the trust anchors their certificates are
 * verified against, and the per-organisation minimum number of authorities a stamp must carry. Every
 * write requires the platform-administrator role, checked in the database, not here.
 */
import { callRpc, getClient } from './db';

const NOT_CONFIGURED = 'The integrity module is not configured.';

export interface TimestampAuthority {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface TrustAnchor {
  id: string;
  name: string;
  enabled: boolean;
}

async function rpcJson(fn: string): Promise<unknown> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc(fn, {});
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function listTimestampAuthorities(): Promise<TimestampAuthority[]> {
  const r = await rpcJson('timestamp_authorities_get');
  if (!Array.isArray(r)) return [];
  return (r as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    name: (a.name as string) ?? '',
    url: (a.url as string) ?? '',
    enabled: Boolean(a.enabled),
    sortOrder: Number(a.sort_order ?? 0),
    notes: (a.notes as string) ?? null,
  }));
}

export async function listTrustAnchors(): Promise<TrustAnchor[]> {
  const r = await rpcJson('timestamp_anchors_get');
  if (!Array.isArray(r)) return [];
  return (r as Record<string, unknown>[]).map((t) => ({
    id: t.id as string,
    name: (t.name as string) ?? '',
    enabled: Boolean(t.enabled),
  }));
}

export function saveTimestampAuthority(
  id: string | null, name: string, url: string, enabled: boolean, sortOrder: number, notes: string
) {
  return callRpc('admin_save_timestamp_authority', {
    p_id: id, p_name: name, p_url: url, p_enabled: enabled, p_sort_order: sortOrder, p_notes: notes,
  }, NOT_CONFIGURED);
}

export function saveTrustAnchor(id: string | null, name: string, certificateDer: string, enabled: boolean) {
  return callRpc('admin_save_trust_anchor', {
    p_id: id, p_name: name, p_certificate_der: certificateDer, p_enabled: enabled,
  }, NOT_CONFIGURED);
}

export function setAnchoringMin(orgId: string, min: number) {
  return callRpc('admin_set_anchoring_min', { p_org: orgId, p_min: min }, NOT_CONFIGURED);
}
