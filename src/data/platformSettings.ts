/**
 * Platform settings (F7). The platform notification recipients list, edited in SA-05 and used for
 * platform alerts too. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface RecipientRow {
  id: string;
  address: string;
}

const NOT_CONFIGURED = 'The platform settings module is not configured.';

export async function listRecipients(): Promise<RecipientRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_recipients');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    address: r.address as string,
  }));
}

export function addRecipient(address: string): Promise<DataResult> {
  return callRpc('platform_add_recipient', { p_address: address }, NOT_CONFIGURED);
}

export function removeRecipient(id: string): Promise<DataResult> {
  return callRpc('platform_remove_recipient', { p_id: id }, NOT_CONFIGURED);
}

/** A permissive address check that mirrors the server's, for inline validation. */
export function looksLikeEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
}
