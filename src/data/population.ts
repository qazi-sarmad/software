/**
 * Population data module (4H, spec §11.1, L3).
 *
 * The population gate lives in the database (migration 0026); this module reads populations and
 * calls lock_population / replace_locked_population. The client computes the SHA-256 before upload
 * so the caller can compare it with the hash the database stored. Components never import the client.
 */
import { callRpc, getClient, type DataResult } from './db';

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

/**
 * Store a population's rows (migration 0119). `population_rows` had no production writer, so a
 * population could be verified yet carry no rows and no draw could ever succeed. The rows are the
 * positional payload `src/lib/populationPaste.ts` emits: `{row_ref, data}` objects, or bare values
 * that the database numbers by position. `append` keeps the existing rows; the default replaces them.
 */
export function importPopulationRows(
  populationId: string, rows: unknown[], append = false
): Promise<DataResult> {
  return callRpc('import_population_rows', {
    p_population_id: populationId, p_rows: rows, p_append: append,
  });
}

/** A bounded page of a population's rows (migration 0119), ordered by row_ref, org-scoped. */
export async function listPopulationRows(
  populationId: string, limit = 500
): Promise<{ rowRef: number; data: Record<string, unknown> }[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_population_rows', {
    p_population_id: populationId, p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { row_ref: number; data: Record<string, unknown> }[];
  return rows.map((r) => ({ rowRef: r.row_ref, data: r.data ?? {} }));
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
