/**
 * Guided first-run data module (U6; SYSTELIGON.md §11.1c Tier 2 item 7).
 *
 * "A new org's dashboard should not be a wall of zeros. It should say 'Create your first universe'
 * with one button." This module is the thin read/write pair behind that surface: the one fact the
 * guided state needs (is the organisation still empty?), and the create path the button calls.
 *
 * A component never imports the Supabase client (rule M8). With no Supabase environment every
 * function is inert: the state read returns null (the screen then falls back to the rows it already
 * holds) and the create returns the shared not-configured reason, so a bare checkout renders its
 * empty state rather than an error.
 */
import { getClient, NOT_CONFIGURED_REASON } from './db';

/** The organisation's data state: counts, and whether it is still empty. Never a row of content. */
export interface OrgDataState {
  universes: number;
  entities: number;
  engagements: number;
  isEmpty: boolean;
}

/**
 * Whether the caller's organisation is still empty (no universe, entity or engagement), and the
 * counts behind the answer. Counts and a boolean only (Law L2). Inert (null) with no client.
 */
export async function getOrgDataState(): Promise<OrgDataState | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('get_org_data_state');
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return null;
  return {
    universes: Number(row.universes ?? 0),
    entities: Number(row.entities ?? 0),
    engagements: Number(row.engagements ?? 0),
    isEmpty: !!row.is_empty,
  };
}

export type CreateUniverseResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Create the organisation's first universe (or any later one). Requires the edit_config right,
 * re-checked in the database. The row, an activity_log entry and a ledger entry are written by the
 * RPC, never by the client.
 */
export async function createUniverse(name: string, domain: string | null = null): Promise<CreateUniverseResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('create_universe', {
    p_name: name,
    p_domain: domain && domain.trim() !== '' ? domain.trim() : null,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: String(data) };
}
