/**
 * Audit-domain data module (D11, docs/AUDIT-DOMAINS-MODEL.md). The screen surface for the three
 * default universes and their disciplines. Reads use the table select policy (RLS decides visibility);
 * writes go through the 0159 RPCs, which re-check the right server-side.
 *
 * Pure data: no React, no clock. The discipline vocabulary itself lives in `src/lib/risk/domains.ts`
 * (S3, read-only here) so the two never drift.
 */
import { callRpcJson, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import { disciplineOf, type Discipline } from '../lib/risk/domains';

export interface UniverseDisciplineRow {
  id: string;
  name: string;
  /** The raw `domain` column value (may be null or a free-text legacy value). */
  domain: string | null;
  /** The domain normalised onto the closed set, or null when it is unknown/unset. */
  discipline: Discipline | null;
}

export function mapUniverseDiscipline(u: Record<string, unknown>): UniverseDisciplineRow {
  const domain = (u.domain as string | null) ?? null;
  return { id: String(u.id), name: String(u.name), domain, discipline: disciplineOf(domain) };
}

/** Every universe in the caller's organisation, with its discipline resolved. Org-scoped by RLS (L2). */
export async function listUniversesWithDiscipline(): Promise<UniverseDisciplineRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('universes').select('id, name, domain').order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapUniverseDiscipline);
}

/**
 * Seed the three default universes (Management / Shari'ah / IT) for one organisation. Idempotent by
 * discipline. Returns the number added and the org's universes after the seed.
 */
export async function seedDefaultUniverses(orgId: string): Promise<
  { ok: true; added: number; universes: UniverseDisciplineRow[] } | { ok: false; reason: string }
> {
  const res = await callRpcJson('seed_default_universes', { p_org: orgId });
  if (!res.ok) return { ok: false, reason: res.reason };
  const data = res.data as { added?: number; universes?: Record<string, unknown>[] };
  return {
    ok: true,
    added: Number(data.added ?? 0),
    universes: (data.universes ?? []).map(mapUniverseDiscipline),
  };
}

/** Set a universe's discipline. Validated and ledgered server-side; refuses an unknown universe. */
export async function setUniverseDomain(
  universeId: string, domain: string, reason: string
): Promise<DataResult> {
  const res = await callRpcJson('set_universe_domain', {
    p_universe_id: universeId, p_domain: domain, p_reason: reason,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** The discipline of one universe, or null. Org-scoped server-side (L2). */
export async function universeDiscipline(universeId: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('universe_discipline', { p_universe_id: universeId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export { NOT_CONFIGURED_REASON };
