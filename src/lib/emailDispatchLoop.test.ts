import { describe, expect, it } from 'vitest';
import {
  buildSendRequest, nextStatus, processRow, redactError, shouldExpire, stubProfile, tokenMatches,
  type QueueRow,
} from '../../supabase/functions/_shared/emailDispatchLoop';
import { type FetchLike } from '../../supabase/functions/_shared/emailAdapters';

function fakeFetch(status: number, body = '{}') {
  const calls: { url: string; init?: { headers?: Record<string, string>; body?: string } }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body };
  };
  return { fn, calls };
}

const row: QueueRow = {
  id: 'row-1', org_id: 'org-1', to_addresses: ['a@example.com'], subject: 'S',
  body_html: '<p>Hello</p>', body_text: null, attempts: 0,
};

describe('email dispatch loop (M-3, F6)', () => {
  it('the stub profile sends nothing and is accepted', async () => {
    const { fn, calls } = fakeFetch(200);
    const out = await processRow(row, stubProfile(), fn);
    expect(out.status).toBe('accepted');
    expect(out.result.provider).toBe('stub');
    expect(calls.length).toBe(0);
  });

  it('a resend profile reaches the Resend API with the row id as the idempotency key', async () => {
    const { fn, calls } = fakeFetch(200, '{"id":"msg-9"}');
    const out = await processRow(row, {
      provider: 'resend', from_address: 'n@q.example', display_name: 'Q', reply_to: null,
      credential: 're_secret',
    }, fn);
    expect(out.status).toBe('sent');
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(calls[0].init?.headers?.['Idempotency-Key']).toBe('row-1');
  });

  it('a Graph delegated 202 is accepted, never sent', async () => {
    const { fn } = fakeFetch(202);
    const out = await processRow(row, {
      provider: 'graph_delegated', from_address: 'n@q.example', display_name: null,
      reply_to: null, credential: 'tok',
    }, fn);
    expect(out.status).toBe('accepted');
    expect(out.result.responseCode).toBe(202);
  });

  it('an SMTP profile on port 25 fails with the plain platform message', async () => {
    const { fn } = fakeFetch(200);
    const out = await processRow(row, {
      provider: 'smtp', from_address: 'n@q.example', display_name: null, reply_to: null,
      config: { port: '25' },
    }, fn, false);
    expect(out.status).toBe('failed');
    expect(out.result.error).toContain('port 25 or 587');
  });

  it('an SMTP profile on port 465 is accepted on the hosted platform', async () => {
    const { fn } = fakeFetch(200);
    const out = await processRow(row, {
      provider: 'smtp', from_address: 'n@q.example', display_name: null, reply_to: null,
      config: { port: '465' },
    }, fn, false);
    expect(out.status).toBe('accepted');
  });

  it('builds a text body from the html when none is given', () => {
    const req = buildSendRequest(row, stubProfile());
    expect(req.bodyText).toBe('Hello');
    expect(req.idempotencyKey).toBe('row-1');
  });

  it('redacts a credential from a provider error', () => {
    expect(redactError('failed api_key=sk-1234')).not.toContain('sk-1234');
    expect(redactError(null)).toBeNull();
  });

  it('the retry status fails only at the fifth attempt', () => {
    expect(nextStatus(1)).toBe('pending');
    expect(nextStatus(4)).toBe('pending');
    expect(nextStatus(5)).toBe('failed');
  });

  it('expires a row older than seven days', () => {
    const now = new Date('2026-10-19T00:00:00Z');
    expect(shouldExpire(new Date('2026-10-11T23:00:00Z'), now)).toBe(true);
    expect(shouldExpire(new Date('2026-10-18T00:00:00Z'), now)).toBe(false);
  });
});

describe('dispatch token check (M-3, F6)', () => {
  it('accepts only an exact match', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('ab', 'abc')).toBe(false);
    expect(tokenMatches('', 'abc')).toBe(false);
    expect(tokenMatches(null, 'abc')).toBe(false);
    expect(tokenMatches('abc', null)).toBe(false);
    expect(tokenMatches('abc', '')).toBe(false);
  });
});
