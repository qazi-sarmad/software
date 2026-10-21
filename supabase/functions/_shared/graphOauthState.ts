/**
 * OAuth `state` for the Microsoft Graph sign-in (C1.1). Pure and injectable: the HMAC crypto is
 * passed in, so the sign and verify paths are unit-tested under Node without a Deno runtime.
 *
 * The state is the anti-CSRF and anti-account-linking control for the delegated consent flow. It
 * binds the user, the organisation (or the literal 'platform') and an expiry into one HMAC-SHA256
 * tag, so `exchange` can prove the flow was started by this user, for this org, within ten minutes,
 * and only once (the nonce is consumed through a service-role-only RPC).
 *
 * The key is derived from the Edge secret SECRETS_MASTER_KEY with a domain-separation label, never
 * from Vault: Vault holds tenant secrets, while the state key is a platform-level signing key, and
 * deriving it keeps the same key material out of two different algorithms.
 */

export const STATE_TTL_MS = 10 * 60 * 1000;
const DOMAIN = 'graph-oauth-state-v1';

export interface StateCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: {
    importKey(
      format: 'raw', keyData: Uint8Array, algorithm: { name: string; hash?: string },
      extractable: boolean, keyUsages: string[]
    ): Promise<unknown>;
    sign(algorithm: { name: string }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

export interface StatePayload {
  /** The signed-in user the flow belongs to. */
  userId: string;
  /** The organisation, or the literal 'platform' for a platform-level flow. */
  orgId: string;
  /** Single-use nonce. */
  nonce: string;
  /** Expiry, milliseconds since the epoch. */
  expiresAt: number;
}

export type StateFailure =
  | 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'wrong_user';

export type StateDecision =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: StateFailure };

export function stateRejection(reason: StateFailure): StateDecision {
  return { ok: false, reason };
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(pad));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Derive the HMAC key from the base64 master key. Deterministic: the same master key always yields
 * the same signing key, so two Edge Function instances agree without any shared state.
 */
export async function deriveStateKey(
  masterKeyBase64: string, crypto: StateCrypto
): Promise<unknown> {
  const binary = atob(masterKeyBase64.trim());
  const master = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const label = new TextEncoder().encode(DOMAIN);
  const combined = new Uint8Array(master.length + label.length);
  combined.set(master, 0);
  combined.set(label, master.length);
  const digest = await crypto.subtle.digest('SHA-256', combined);
  return crypto.subtle.importKey(
    'raw', new Uint8Array(digest), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}

/** A fresh nonce: 16 random bytes, base64url. Randomness is required for a nonce, not audit logic. */
export function newNonce(crypto: StateCrypto): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Sign a payload into `base64url(payload).base64url(hmac)`. */
export async function signState(
  payload: StatePayload, key: unknown, crypto: StateCrypto
): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    { name: 'HMAC' }, key, new TextEncoder().encode(body)
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** A constant-time comparison of two equal-length byte arrays. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Verify a state token. Every failure mode is a distinct reason, so the caller can log the cause and
 * the test can prove each refusal. A missing, malformed, forged or expired state never passes, and a
 * state bound to a different user is refused even when the signature is genuine.
 */
export async function verifyState(
  token: string | null | undefined, key: unknown, crypto: StateCrypto,
  expectedUserId: string, now: number
): Promise<StateDecision> {
  if (!token || token.trim() === '') return stateRejection('missing');
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return stateRejection('malformed');

  let expected: Uint8Array;
  let provided: Uint8Array;
  let payload: StatePayload;
  try {
    expected = new Uint8Array(
      await crypto.subtle.sign({ name: 'HMAC' }, key, new TextEncoder().encode(parts[0]))
    );
    provided = fromBase64Url(parts[1]);
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
  } catch {
    return stateRejection('malformed');
  }

  if (!bytesEqual(expected, provided)) return stateRejection('bad_signature');

  if (typeof payload?.userId !== 'string' || typeof payload?.orgId !== 'string'
      || typeof payload?.nonce !== 'string' || typeof payload?.expiresAt !== 'number') {
    return stateRejection('malformed');
  }
  if (payload.expiresAt <= now) return stateRejection('expired');
  if (payload.userId !== expectedUserId) return stateRejection('wrong_user');

  return { ok: true, payload };
}
