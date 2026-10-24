/**
 * User preferences data module (H3a, spec §27.5).
 *
 * The only place the record-view preference is read and written. Reads and writes go through the
 * user_preferences RPCs in migration 0024, so the database decides the caller's org from the JWT
 * and a user can only touch their own row. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

/** The record-view preference key (§27.5, H3). */
export const RECORD_VIEW_MODE = 'record_view_mode';

export type RecordViewMode = 'full_page' | 'floating_window';

export const DEFAULT_RECORD_VIEW_MODE: RecordViewMode = 'full_page';

export function isRecordViewMode(value: string | null | undefined): value is RecordViewMode {
  return value === 'full_page' || value === 'floating_window';
}

/** Read one preference value for the signed-in user, or null when unset / not configured. */
export async function getPreference(key: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('get_user_preference', { p_key: key });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Write one preference value for the signed-in user. */
export function setPreference(key: string, value: string): Promise<DataResult> {
  return callRpc('set_user_preference', { p_key: key, p_value: value });
}

/** Read the record-view preference, defaulting to full_page (§27.5) when unset. */
export async function getRecordViewMode(): Promise<RecordViewMode> {
  const value = await getPreference(RECORD_VIEW_MODE);
  return isRecordViewMode(value) ? value : DEFAULT_RECORD_VIEW_MODE;
}

export function setRecordViewMode(mode: RecordViewMode): Promise<DataResult> {
  return setPreference(RECORD_VIEW_MODE, mode);
}
