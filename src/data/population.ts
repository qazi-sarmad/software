/**
 * Population data module (4H, spec §11.1, L3).
 *
 * The population gate lives in the database (migration 0026); this module reads populations and
 * calls lock_population / replace_locked_population. The client computes the SHA-256 before upload
 * so the caller can compare it with the hash the database stored. Components never import the client.
 */
import { callRpc, getClient, type DataResult } from './db';
import type { EvidenceRecord } from '../lib/systeligon';

export type PopulationStatus =
  | 'pending' | 'uploading' | 'verifying' | 'verified' | 'rejected' | 'locked' | 'archived';

export interface PopulationRow {
  id: string;
  engagementId: string;
  workpaperId: string | null;
  filename: string | null;
  rowCount: number | null;
  sha256: string | null;
  status: PopulationStatus;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export function lockPopulation(populationId: string): Promise<DataResult> {
  return callRpc('lock_population', { p_population_id: populationId });
}

/**
 * Register a population from an uploaded file. No RPC exists for this (0026 registers through a direct
 * insert under the `populations_write` policy), so the insert lives here, not in the component: the
 * database's `verify_population` trigger accepts it only when the SHA-256 and row count are both set.
 */
export async function registerPopulation(
  engagementId: string, filename: string, sha256: string, rowCount: number
): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'The data module is not configured.' };
  const { error } = await sb.from('populations').insert({
    engagement_id: engagementId,
    filename,
    sha256,
    row_count: rowCount,
    status: 'verified',
  });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

export function replaceLockedPopulation(populationId: string, rationale: string): Promise<DataResult> {
  return callRpc('replace_locked_population', { p_population_id: populationId, p_rationale: rationale });
}

/** A population row reduced to the fields the D2 capability family reads. */
export interface PopulationRecordRead {
  rowRef: number | string;
  amountCents: number | null;
  date: string | null;
  category: string | null;
}

/**
 * Read a population's rows for the deterministic capability library (D2). The row payload is free
 * form, so the well-known keys are mapped and anything else is left null — the capability reports a
 * missing value honestly rather than inventing one. RLS filters the rows to the caller's org.
 */
export async function listPopulationRecords(populationId: string): Promise<PopulationRecordRead[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('population_rows')
    .select('row_ref, data')
    .eq('population_id', populationId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const payload = (r.data ?? {}) as Record<string, unknown>;
    const amount = payload.amount ?? payload.amt ?? payload.value ?? payload.cents;
    const date = payload.date ?? payload.txn_date ?? payload.transaction_date;
    const category = payload.category ?? payload.dept ?? payload.account;
    return {
      rowRef: (r.row_ref as number) ?? 0,
      amountCents: typeof amount === 'number' ? amount : null,
      date: typeof date === 'string' ? date : null,
      category: typeof category === 'string' ? category : null,
    };
  });
}

/**
 * A configuration text under test by the `config` scope's pattern rules (S9, spec §5). The values are
 * the org's own append-only `config_versions` rows, rendered to text so a pattern rule can cite the
 * exact line. The org is the caller's own; RLS restricts the read to it.
 */
export interface ConfigSource {
  ref: string;
  text: string;
}

/**
 * Read the org's configuration as text, one entry per key (newest version), for the config-scope
 * pattern rules. Empty when unconfigured. Nothing leaves the tenant: this is the tenant's own config.
 */
export async function listConfigSources(): Promise<ConfigSource[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('config_versions')
    .select('key, value, version')
    .order('key', { ascending: true })
    .order('version', { ascending: false });
  if (error) throw new Error(error.message);
  const newest = new Map<string, ConfigSource>();
  for (const r of data ?? []) {
    const key = String(r.key);
    if (newest.has(key)) continue; // rows are version-desc, so the first seen is the newest
    newest.set(key, { ref: key, text: `${key}=${JSON.stringify(r.value)}` });
  }
  return [...newest.values()];
}

/**
 * The evidence a Mode-B (evidence-vs-remark) verification checks, in the shape `flows.ts` consumes
 * (S5, spec §6). It is built from the workpaper's evidence files: a file is `reachable` when its bytes
 * are stored (a session-only file has none), its `type` is derived from the filename so a mismatch is
 * a real mismatch, and the recorded hash is the hash the store took at attachment. `period`, `entity`
 * and `amount` are left unset — the store does not carry them, and Mode B must not invent a claim.
 */
export async function listEvidenceRecords(workpaperId: string): Promise<Record<string, EvidenceRecord>> {
  const sb = getClient();
  if (!sb) return {};
  const { data, error } = await sb.rpc('evidence_files_for', { p_workpaper_id: workpaperId });
  if (error) throw new Error(error.message);
  const out: Record<string, EvidenceRecord> = {};
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = r.id as string;
    const filename = (r.filename as string | null) ?? '';
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    const type = ext === 'pdf' ? 'pdf'
      : ext === 'csv' || ext === 'xlsx' || ext === 'xls' || ext === 'tsv' ? 'sheet'
      : ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' ? 'image'
      : ext === 'txt' || ext === 'md' ? 'text'
      : 'file';
    out[id] = {
      id,
      // A session-only file has no stored bytes and can never be verified; reachable is the store's
      // own answer, not assumed.
      reachable: Boolean(r.storage_path),
      type,
      contentSha256: (r.content_sha256 as string | null) ?? '',
    };
  }
  return out;
}

export async function listPopulations(engagementId: string): Promise<PopulationRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('populations')
    .select('id, engagement_id, workpaper_id, filename, row_count, sha256, status, verified_at, verified_by')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    engagementId: p.engagement_id as string,
    workpaperId: (p.workpaper_id as string | null) ?? null,
    filename: (p.filename as string | null) ?? null,
    rowCount: (p.row_count as number | null) ?? null,
    sha256: (p.sha256 as string | null) ?? null,
    status: (p.status as PopulationStatus) ?? 'pending',
    verifiedAt: (p.verified_at as string | null) ?? null,
    verifiedBy: (p.verified_by as string | null) ?? null,
  }));
}

/**
 * SHA-256 of a file, computed in the browser before upload so the caller can verify the hash the
 * database stored matches the bytes that were hashed (spec §11.1). Uses WebCrypto; never Node crypto.
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
