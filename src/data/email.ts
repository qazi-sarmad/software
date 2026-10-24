/**
 * Email queue data module (6G, spec §16, §24).
 *
 * Dispatch is out of scope (NOT-DONE §email-dispatch): this module only reads what is queued. Pending
 * rows are not visible to org roles (they are sent by the platform), so a caller only sees sent/failed
 * rows for its own org. Components never import the Supabase client.
 */
import { getClient } from './db';

export type EmailStatus = 'pending' | 'sent' | 'failed';

export interface EmailQueueRow {
  id: string;
  toAddresses: string[];
  subject: string;
  status: EmailStatus;
  errorText: string | null;
  sentAt: string | null;
  createdAt: string | null;
  metadata: Record<string, unknown>;
}

export interface EmailSettingsRow {
  orgId: string;
  provider: string;
}

/**
 * Queue rows visible to the caller's org. Pending rows are excluded for org roles by RLS; the platform
 * role sees them. The caller passes a status filter to mirror the UI's "Email queued" notice.
 */
export async function listEmailQueue(status: EmailStatus | null = null): Promise<EmailQueueRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb
    .from('email_queue')
    .select('id, to_addresses, subject, status, error_text, sent_at, created_at, metadata')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    toAddresses: (r.to_addresses as string[] | null) ?? [],
    subject: r.subject as string,
    status: (r.status as EmailStatus) ?? 'pending',
    errorText: (r.error_text as string | null) ?? null,
    sentAt: (r.sent_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
  }));
}

/** The non-secret provider name for the org (provider_config is not selectable by org roles, §6E). */
export async function getEmailSettings(): Promise<EmailSettingsRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('email_settings')
    .select('org_id, provider')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { orgId: data.org_id as string, provider: (data.provider as string | null) ?? 'stub' };
}
