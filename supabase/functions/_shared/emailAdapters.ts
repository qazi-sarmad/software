/**
 * Email provider adapters (F6). Pure modules with an injected fetch, so they are unit-tested without
 * a network and reused by the email-dispatch Edge Function.
 *
 * Laws that shape this file:
 *   - F5: a credential is passed in by the caller and never returned, logged or echoed.
 *   - F6: the hosted platform blocks outbound ports 25 and 587; only 465 works there. Graph 202 means
 *     accepted, never delivered, and the UI must say so.
 *   - L1: no randomness. The idempotency key is the queue row id, given by the caller.
 */

export type FetchLike = (
  input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ status: number; text: () => Promise<string> }>;

export type ProviderKind = 'stub' | 'resend' | 'graph_delegated' | 'graph_app' | 'smtp';

export interface SendRequest {
  to: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  fromAddress: string;
  fromName?: string;
  replyTo?: string;
  /** The queue row id; used as the idempotency key. */
  idempotencyKey: string;
  /** Never logged. */
  credential?: string;
  /** Provider-specific settings, from the sender profile. */
  config?: Record<string, string>;
}

export interface SendResult {
  /** 'sent' is delivered to the provider; 'accepted' means the provider took it and will try. */
  status: 'sent' | 'accepted' | 'failed';
  provider: ProviderKind;
  responseCode: number | null;
  providerMessageId?: string;
  error?: string;
}

export const SMTP_BLOCKED_PORTS = [25, 587];
export const SMTP_HOSTED_PORT = 465;

/**
 * Whether a port may be used on the hosted platform. On self-hosted Supabase the deployment flag
 * `outbound_smtp_allowed` lifts the restriction (F6).
 */
export function smtpPortAllowed(port: number, outboundSmtpAllowed: boolean): boolean {
  if (outboundSmtpAllowed) return true;
  return !SMTP_BLOCKED_PORTS.includes(port);
}

export const SMTP_PORT_MESSAGE =
  'This server cannot use port 25 or 587 from the hosted platform; use port 465, Resend, or Microsoft.';

/** Resend: HTTPS API, Idempotency-Key = the queue row id, at most 50 recipients (F6). */
export async function sendViaResend(req: SendRequest, fetchImpl: FetchLike): Promise<SendResult> {
  if (req.to.length > 50) {
    return { status: 'failed', provider: 'resend', responseCode: null, error: 'at most 50 recipients per message' };
  }
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.credential ?? ''}`,
      'Idempotency-Key': req.idempotencyKey,
    },
    body: JSON.stringify({
      from: req.fromName ? `${req.fromName} <${req.fromAddress}>` : req.fromAddress,
      to: req.to,
      subject: req.subject,
      html: req.bodyHtml,
      text: req.bodyText,
      reply_to: req.replyTo,
    }),
  });
  const body = await res.text();
  if (res.status >= 200 && res.status < 300) {
    let id: string | undefined;
    try { id = (JSON.parse(body) as { id?: string }).id; } catch { id = undefined; }
    return { status: 'sent', provider: 'resend', responseCode: res.status, providerMessageId: id };
  }
  return { status: 'failed', provider: 'resend', responseCode: res.status, error: redact(body) };
}

/**
 * Microsoft Graph, delegated: the signed-in user's mailbox. POST /me/sendMail. HTTP 202 is ACCEPTED,
 * not delivered (F6).
 */
export async function sendViaGraphDelegated(req: SendRequest, fetchImpl: FetchLike): Promise<SendResult> {
  const res = await fetchImpl('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.credential ?? ''}` },
    body: JSON.stringify({
      message: {
        subject: req.subject,
        body: { contentType: 'HTML', content: req.bodyHtml },
        toRecipients: req.to.map((a) => ({ emailAddress: { address: a } })),
        replyTo: req.replyTo ? [{ emailAddress: { address: req.replyTo } }] : undefined,
      },
      saveToSentItems: true,
    }),
  });
  const body = await res.text();
  if (res.status === 202 || (res.status >= 200 && res.status < 300)) {
    return { status: 'accepted', provider: 'graph_delegated', responseCode: res.status };
  }
  return { status: 'failed', provider: 'graph_delegated', responseCode: res.status, error: redact(body) };
}

/**
 * Microsoft Graph, application permission: POST /users/{mailbox}/sendMail. The client must restrict
 * the app to the chosen mailbox (F6).
 */
export async function sendViaGraphApp(req: SendRequest, fetchImpl: FetchLike): Promise<SendResult> {
  const mailbox = req.config?.mailbox ?? req.fromAddress;
  const res = await fetchImpl(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.credential ?? ''}` },
      body: JSON.stringify({
        message: {
          subject: req.subject,
          body: { contentType: 'HTML', content: req.bodyHtml },
          toRecipients: req.to.map((a) => ({ emailAddress: { address: a } })),
        },
        saveToSentItems: true,
      }),
    }
  );
  const body = await res.text();
  if (res.status === 202 || (res.status >= 200 && res.status < 300)) {
    return { status: 'accepted', provider: 'graph_app', responseCode: res.status };
  }
  return { status: 'failed', provider: 'graph_app', responseCode: res.status, error: redact(body) };
}

/**
 * SMTP. This module does not open a socket — the Edge Function does — but it owns the port rule and
 * the plain-language failure, so the rule is tested here.
 */
export function checkSmtpConfig(
  port: number, outboundSmtpAllowed: boolean
): { ok: true } | { ok: false; error: string } {
  if (!smtpPortAllowed(port, outboundSmtpAllowed)) {
    return { ok: false, error: SMTP_PORT_MESSAGE };
  }
  return { ok: true };
}

/**
 * The stub adapter: queue only, nothing sent, and the UI says so (F6). A tenant with no working
 * sender resolves to this.
 */
export function stubResult(): SendResult {
  return { status: 'accepted', provider: 'stub', responseCode: null };
}

/** Strip anything that looks like a credential out of a provider error (F5). */
export function redact(text: string): string {
  return text.replace(
    /(api[_-]?key|token|password|secret|bearer)\s*[:=]?\s*\S+/gi,
    '$1 ••••'
  );
}

/**
 * The dispatch function: pick the adapter by provider and send. The stub and an unknown provider fall
 * back to the stub result. The credential is never echoed.
 */
export async function dispatchEmail(
  provider: ProviderKind, req: SendRequest, fetchImpl: FetchLike,
  outboundSmtpAllowed = false
): Promise<SendResult> {
  switch (provider) {
    case 'resend':
      return sendViaResend(req, fetchImpl);
    case 'graph_delegated':
      return sendViaGraphDelegated(req, fetchImpl);
    case 'graph_app':
      return sendViaGraphApp(req, fetchImpl);
    case 'smtp': {
      const port = Number(req.config?.port ?? 465);
      const check = checkSmtpConfig(port, outboundSmtpAllowed);
      if (!check.ok) {
        return { status: 'failed', provider: 'smtp', responseCode: null, error: check.error };
      }
      // The socket is opened by the Edge Function; reaching here means the config is acceptable.
      return { status: 'accepted', provider: 'smtp', responseCode: null };
    }
    case 'stub':
    default:
      return stubResult();
  }
}

/** Retry backoff in minutes, by attempt number (F6). Attempt 5 is the last. */
export const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];
export const MAX_ATTEMPTS = 5;

export function backoffMinutes(attempt: number): number | null {
  if (attempt < 1 || attempt > MAX_ATTEMPTS) return null;
  return RETRY_BACKOFF_MINUTES[attempt - 1];
}

/** Whether a message has aged out of the queue (F6): pending rows older than 7 days expire. */
export function isExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > 7 * 24 * 60 * 60 * 1000;
}

/** A plain hint for a provider error, one line, shown under the verbatim error (F6). */
export function errorHint(provider: ProviderKind, responseCode: number | null): string {
  if (provider === 'resend') {
    if (responseCode === 401) return 'Check that the Resend API key is correct and still active.';
    if (responseCode === 403) return 'The Resend key may not be allowed to send from this address.';
    if (responseCode === 422) return 'Resend rejected the message. Check the from address and the recipients.';
    return 'Resend rejected the message. Check the key, the from address and the recipients.';
  }
  if (provider === 'graph_delegated' || provider === 'graph_app') {
    if (responseCode === 401) return 'The Microsoft sign-in has expired. Sign in again.';
    if (responseCode === 403) return 'The Microsoft app does not have permission to send as this mailbox.';
    return 'Microsoft rejected the message. Check the app permission and the mailbox.';
  }
  if (provider === 'smtp') return 'Check the host, port and password. On the hosted platform use port 465.';
  return 'Check the sender settings.';
}
