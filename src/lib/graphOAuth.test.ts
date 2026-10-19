import { describe, expect, it } from 'vitest';
import {
  authorizeUrl, clientCredentials, exchangeCode, refreshToken,
} from '../../supabase/functions/_shared/graphOAuth';
import { type FetchLike } from '../../supabase/functions/_shared/emailAdapters';

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init?: { body?: string; headers?: Record<string, string> } }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body };
  };
  return { fn, calls };
}

describe('Microsoft Graph OAuth (M-3, F6)', () => {
  it('exchanges a code for tokens', async () => {
    const { fn, calls } = fakeFetch(200,
      '{"access_token":"at","refresh_token":"rt","expires_in":3600}');
    const r = await exchangeCode('code-1', 'https://app.example/cb', 'cid', 'csec', fn);
    expect(r.ok).toBe(true);
    expect(r.accessToken).toBe('at');
    expect(r.refreshToken).toBe('rt');
    expect(calls[0].init?.body).toContain('grant_type=authorization_code');
    expect(calls[0].init?.body).toContain('Mail.Send');
  });

  it('keeps the old refresh token when the rotation omits a new one', async () => {
    const { fn } = fakeFetch(200, '{"access_token":"at2","expires_in":3600}');
    const r = await refreshToken('old-rt', 'cid', 'csec', fn);
    expect(r.ok).toBe(true);
    expect(r.refreshToken).toBe('old-rt');
  });

  it('stores the rotated refresh token when Microsoft issues one', async () => {
    const { fn } = fakeFetch(200, '{"access_token":"at3","refresh_token":"new-rt"}');
    const r = await refreshToken('old-rt', 'cid', 'csec', fn);
    expect(r.refreshToken).toBe('new-rt');
  });

  it('surfaces a provider error, redacted', async () => {
    const { fn } = fakeFetch(400,
      '{"error":"invalid_grant","error_description":"token=secret123 is bad"}');
    const r = await refreshToken('old', 'cid', 'csec', fn);
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain('secret123');
  });

  it('handles an unreadable body', async () => {
    const { fn } = fakeFetch(500, 'not json');
    const r = await exchangeCode('c', 'r', 'cid', 'csec', fn);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unreadable');
  });

  it('the application flow requests the .default scope', async () => {
    const { fn, calls } = fakeFetch(200, '{"access_token":"app-at"}');
    const r = await clientCredentials('tenant-1', 'cid', 'csec', fn);
    expect(r.ok).toBe(true);
    expect(calls[0].init?.body).toContain('client_credentials');
    expect(calls[0].init?.body).toContain('.default');
  });

  it('builds a consent URL with Mail.Send and offline_access', () => {
    const url = authorizeUrl('cid', 'https://app.example/cb');
    expect(url).toContain('response_type=code');
    expect(url).toContain('Mail.Send');
    expect(url).toContain('offline_access');
  });
});
