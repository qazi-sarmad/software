/**
 * Guided first-run data module (U6; SYSTELIGON.md §11.1c Tier 2 item 7).
 *
 * "A new org's dashboard should not be a wall of zeros. It should say 'Create your first universe'
 * with one button." This module is the thin read behind that surface: the one fact the guided state
 * needs — is the organisation still empty? The create path lives in `src/data/mutations.ts`
 * (`createUniverse`), wired through AppContext, so it is not duplicated here.
 *
 * A component never imports the Supabase client (rule M8). With no Supabase environment the read is
 * inert and returns null, so the screen falls back to the rows it already holds and a bare checkout
 * renders its empty state rather than an error.
 */
import { getClient } from './db';

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

// The create path is `createUniverse` in `src/data/mutations.ts` (wired through AppContext), so it is
// not duplicated here. This module owns only the read the guided state needs.
