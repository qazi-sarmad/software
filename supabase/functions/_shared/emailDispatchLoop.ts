/**
 * The email-dispatch loop (M-3, F6). Pure: it takes a claimed queue row and its resolved sender
 * profile, builds the adapter request and returns the adapter's result. The Edge Function owns the
 * database calls; this module owns the decisions, so every branch is unit-tested with a fake fetch.
 *
 * Laws that shape this file:
 *   - F6: one queue, one dispatcher. A row resolves to the tenant profile, then the platform default,
 *     then stub. HTTP 202 from Graph is 'accepted', never 'delivered'.
 *   - F5: the credential is passed to the adapter and never returned, logged or stored.
 *   - L1: no randomness. The idempotency key is the queue row id.
 */

import {
  MAX_ATTEMPTS, dispatchEmail, redact, type FetchLike, type ProviderKind, type SendRequest, type SendResult,
} from './emailAdapters.ts';

export interface QueueRow {
  id: string;
  org_id: string;
  to_addresses: string[];
  subject: string;
  body_html: string | null;
  body_text: string | null;
  attempts: number;
  metadata?: Record<string, unknown> | null;
}

export interface ResolvedProfile {
  provider: ProviderKind;
  from_address: string | null;
  display_name: string | null;
  reply_to: string | null;
  credential?: string | null;
  config?: Record<string, string> | null;
}

/** A profile that resolved to nothing: the stub. Queued, not sent (F6). */
export function stubProfile(): ResolvedProfile {
  return { provider: 'stub', from_address: null, display_name: null, reply_to: null };
}

/** Build the adapter request for one row. The credential is carried, never returned to a caller. */
export function buildSendRequest(row: QueueRow, profile: ResolvedProfile): SendRequest {
  const html = row.body_html ?? '';
  return {
    to: row.to_addresses ?? [],
    subject: row.subject,
    bodyHtml: html,
    bodyText: row.body_text ?? html.replace(/<[^>]+>/g, ' ').trim(),
    fromAddress: profile.from_address ?? '',
    fromName: profile.display_name ?? undefined,
    replyTo: profile.reply_to ?? undefined,
    idempotencyKey: row.id,
    credential: profile.credential ?? undefined,
    config: profile.config ?? undefined,
  };
}

export interface RowOutcome {
  id: string;
  result: SendResult;
  /** The status to write back: 'sent' only for a real send; 'accepted' for Graph/stub. */
  status: 'sent' | 'accepted' | 'failed';
}

/**
 * Send one row through its adapter. A stub profile always returns 'accepted' with no network call, so
 * a tenant with no working sender queues and waits, exactly as F6 requires.
 */
export async function processRow(
  row: QueueRow, profile: ResolvedProfile, fetchImpl: FetchLike, outboundSmtpAllowed = false
): Promise<RowOutcome> {
  const req = buildSendRequest(row, profile);
  const result = await dispatchEmail(profile.provider, req, fetchImpl, outboundSmtpAllowed);
  const status = result.status === 'sent' ? 'sent' : result.status === 'accepted' ? 'accepted' : 'failed';
  return { id: row.id, result, status };
}

/**
 * The dispatch token check (F6). The publishable key alone must not be enough: a request is refused
 * unless the x-dispatch-token header equals the Vault secret. The comparison does not short-circuit on
 * the first differing byte.
 */
export function tokenMatches(header: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false;
  if (!header) return false;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i += 1) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Whether a row has aged out of the queue (F6): pending rows older than 7 days expire. */
export function shouldExpire(createdAt: Date, now: Date, days = 7): boolean {
  return now.getTime() - createdAt.getTime() > days * 24 * 60 * 60 * 1000;
}

/** The row-level retry decision, so the function and the tests agree on it (F6). */
export const DISPATCH_MAX_ATTEMPTS = MAX_ATTEMPTS;

export function nextStatus(attempts: number): 'pending' | 'failed' {
  return attempts >= DISPATCH_MAX_ATTEMPTS ? 'failed' : 'pending';
}

/** Redact a provider error before it is written to the queue row (F5). */
export function redactError(error: string | null | undefined): string | null {
  return error ? redact(error) : null;
}
