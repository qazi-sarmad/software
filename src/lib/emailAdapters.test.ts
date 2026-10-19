import { describe, expect, it } from 'vitest';
import {
  MAX_ATTEMPTS, RETRY_BACKOFF_MINUTES, SMTP_BLOCKED_PORTS, SMTP_HOSTED_PORT, SMTP_PORT_MESSAGE,
  backoffMinutes, checkSmtpConfig, dispatchEmail, errorHint, isExpired, redact,
  sendViaGraphApp, sendViaGraphDelegated, sendViaResend, smtpPortAllowed, stubResult,
  type FetchLike, type SendRequest,
} from '../../supabase/functions/_shared/emailAdapters';

function fakeFetch(status: number, body = '{}') {
  const calls: { url: string; init?: { headers?: Record<string, string>; body?: string } }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body };
  };
  return { fn, calls };
}

const base: SendRequest = {
  to: ['a@example.com'], subject: 'S', bodyHtml: '<p>H</p>', bodyText: 'H',
  fromAddress: 'noreply@qscorp.example', idempotencyKey: 'row-1', credential: 're_secret',
};

describe('email adapters (F6, F5)', () => {
  it('the stub adapter accepts but sends nothing', () => {
    const r = stubResult();
    expect(r.status).toBe('accepted');
    expect(r.provider).toBe('stub');
    expect(r.responseCode).toBeNull();
  });

  it('resend posts with the row id as the Idempotency-Key', async () => {
    const { fn, calls } = fakeFetch(200, '{"id":"abc"}');
    const r = await sendViaResend(base, fn);
    expect(r.status).toBe('sent');
    expect(r.providerMessageId).toBe('abc');
    expect(calls[0].init?.headers?.['Idempotency-Key']).toBe('row-1');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
  });

  it('resend refuses more than 50 recipients without calling the provider', async () => {
    const { fn, calls } = fakeFetch(200);
    const many = { ...base, to: Array.from({ length: 51 }, (_, i) => `u${i}@x.test`) };
    const r = await sendViaResend(many, fn);
    expect(r.status).toBe('failed');
    expect(calls.length).toBe(0);
  });

  it('resend redacts a credential echoed in an error body', async () => {
    const { fn } = fakeFetch(401, 'invalid api_key: re_leaked_value');
    const r = await sendViaResend(base, fn);
    expect(r.status).toBe('failed');
    expect(r.error).not.toContain('re_leaked_value');
    expect(r.error).toContain('••••');
  });

  it('graph delegated treats 202 as accepted, never delivered', async () => {
    const { fn } = fakeFetch(202);
    const r = await sendViaGraphDelegated(base, fn);
    expect(r.status).toBe('accepted');
    expect(r.provider).toBe('graph_delegated');
  });

  it('graph app posts to the chosen mailbox', async () => {
    const { fn, calls } = fakeFetch(202);
    const r = await sendViaGraphApp({ ...base, config: { mailbox: 'shared@qscorp.example' } }, fn);
    expect(r.status).toBe('accepted');
    expect(calls[0].url).toContain('/users/shared%40qscorp.example/sendMail');
  });

  it('smtp allows 465 on the hosted platform and refuses 25 and 587', () => {
    expect(smtpPortAllowed(SMTP_HOSTED_PORT, false)).toBe(true);
    for (const p of SMTP_BLOCKED_PORTS) expect(smtpPortAllowed(p, false)).toBe(false);
  });

  it('self-hosted lifts the port restriction', () => {
    expect(smtpPortAllowed(25, true)).toBe(true);
    expect(checkSmtpConfig(587, true).ok).toBe(true);
  });

  it('the port failure message is exactly the plain-language one', () => {
    const check = checkSmtpConfig(587, false);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toBe(SMTP_PORT_MESSAGE);
  });

  it('dispatching smtp on a blocked port fails before any socket', async () => {
    const { fn, calls } = fakeFetch(200);
    const r = await dispatchEmail('smtp', { ...base, config: { port: '587' } }, fn);
    expect(r.status).toBe('failed');
    expect(calls.length).toBe(0);
  });

  it('dispatching an unknown provider falls back to the stub', async () => {
    const { fn } = fakeFetch(200);
    const r = await dispatchEmail('nope' as never, base, fn);
    expect(r.provider).toBe('stub');
  });

  it('backoff follows 1, 5, 15, 60, 240 minutes and stops after five', () => {
    expect(RETRY_BACKOFF_MINUTES).toEqual([1, 5, 15, 60, 240]);
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(MAX_ATTEMPTS)).toBe(240);
    expect(backoffMinutes(MAX_ATTEMPTS + 1)).toBeNull();
    expect(backoffMinutes(0)).toBeNull();
  });

  it('a row older than seven days has expired', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    expect(isExpired(new Date('2026-10-11T00:00:00Z'), now)).toBe(true);
    expect(isExpired(new Date('2026-10-13T00:00:00Z'), now)).toBe(false);
  });

  it('the redactor removes a bearer token', () => {
    expect(redact('Bearer abc123')).toContain('••••');
    expect(redact('Bearer abc123')).not.toContain('abc123');
  });

  it('each provider has a plain hint for a failure', () => {
    for (const p of ['resend', 'graph_delegated', 'graph_app', 'smtp'] as const) {
      expect(errorHint(p, 401).length).toBeGreaterThan(10);
    }
  });
});
