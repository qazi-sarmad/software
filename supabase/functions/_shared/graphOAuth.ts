/**
 * Microsoft Graph OAuth helpers (M-3, F6). Pure with an injected fetch, so the code exchange and the
 * refresh-token rotation are unit-tested without a network.
 *
 * The refresh token is a secret (F5): it is returned to the caller, which stores it through the
 * secrets-put path (Vault or AES), never in a table column and never in a log.
 *
 * F6: the platform registers ONE multi-tenant Microsoft app; its client id and secret are entered by
 * the Super Admin and stored in Vault.
 */

import { redact, type FetchLike } from './emailAdapters.ts';

const GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export interface TokenResponse {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  error?: string;
}

function parseTokenBody(body: string): TokenResponse {
  let parsed: {
    access_token?: string; refresh_token?: string; expires_in?: number;
    error?: string; error_description?: string;
  };
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: 'the sign-in service returned an unreadable response' };
  }
  if (parsed.error) {
    return { ok: false, error: redact(parsed.error_description ?? parsed.error) };
  }
  if (!parsed.access_token) {
    return { ok: false, error: 'the sign-in service returned no access token' };
  }
  return {
    ok: true,
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresIn: parsed.expires_in,
  };
}

/** The delegated scopes F6 names: Mail.Send plus offline_access, so a refresh token is issued. */
export const DELEGATED_SCOPES = 'Mail.Send offline_access';

/** Exchange an authorization code for tokens (the delegated sign-in, once). */
export async function exchangeCode(
  code: string, redirectUri: string, clientId: string, clientSecret: string, fetchImpl: FetchLike
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: DELEGATED_SCOPES,
  });
  const res = await fetchImpl(GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return parseTokenBody(await res.text());
}

/** Rotate a refresh token. Microsoft may issue a new refresh token; the caller stores whichever
 *  token is returned, so the rotation is never lost. */
export async function refreshToken(
  refresh: string, clientId: string, clientSecret: string, fetchImpl: FetchLike
): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
    grant_type: 'refresh_token',
    scope: DELEGATED_SCOPES,
  });
  const res = await fetchImpl(GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const parsed = parseTokenBody(await res.text());
  // A refresh that omits a new refresh token keeps the old one (Microsoft's documented behaviour).
  if (parsed.ok && !parsed.refreshToken) parsed.refreshToken = refresh;
  return parsed;
}

/** The application-permission flow (graph_app): client credentials, no user. */
export async function clientCredentials(
  tenantId: string, clientId: string, clientSecret: string, fetchImpl: FetchLike
): Promise<TokenResponse> {
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return parseTokenBody(await res.text());
}

/**
 * The consent URL the configuration actor opens for the delegated flow. The signed `state` is a
 * required argument (C1.1): without it the flow would be open to CSRF and account linking.
 */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: DELEGATED_SCOPES,
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}
