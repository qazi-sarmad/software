/**
 * C1.1: the OAuth state token binds the user, the org and an expiry into one HMAC, and every failure
 * mode is a distinct refusal. Pure with the WebCrypto injected, so it runs under Node.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveStateKey, newNonce, signState, verifyState, STATE_TTL_MS,
  type StateCrypto, type StatePayload,
} from '../../supabase/functions/_shared/graphOauthState';

const cryptoImpl = crypto as unknown as StateCrypto;
const MASTER = btoa('0123456789abcdef0123456789abcdef');
const OTHER_MASTER = btoa('fedcba9876543210fedcba9876543210');
const USER_A = '10000000-0000-0000-0000-0000000000a1';
const USER_B = '10000000-0000-0000-0000-0000000000b1';
const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const NOW = 1_000_000;

async function signed(master = MASTER, over: Partial<StatePayload> = {}): Promise<string> {
  const key = await deriveStateKey(master, cryptoImpl);
  return signState({
    userId: USER_A, orgId: ORG_A, nonce: newNonce(cryptoImpl), expiresAt: NOW + STATE_TTL_MS, ...over,
  }, key, cryptoImpl);
}

describe('OAuth state (C1.1)', () => {
  it('accepts a fresh state signed for this user and org', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    const d = await verifyState(await signed(), key, cryptoImpl, USER_A, NOW);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.payload.userId).toBe(USER_A);
      expect(d.payload.orgId).toBe(ORG_A);
      expect(d.payload.nonce).toBeTruthy();
    }
  });

  it('refuses a missing state', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    expect(await verifyState('', key, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: false, reason: 'missing' });
    expect(await verifyState(null, key, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('refuses a malformed state', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    expect(await verifyState('no-dot-here', key, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('refuses a state signed with another key (forged)', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    const forged = await signed(OTHER_MASTER);
    expect(await verifyState(forged, key, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('refuses an expired state', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    const token = await signed(MASTER, { expiresAt: NOW - 1 });
    expect(await verifyState(token, key, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a genuine state bound to another user', async () => {
    const key = await deriveStateKey(MASTER, cryptoImpl);
    expect(await verifyState(await signed(), key, cryptoImpl, USER_B, NOW)).toMatchObject({ ok: false, reason: 'wrong_user' });
  });

  it('the nonce differs between two states for the same user', async () => {
    const a = await signed();
    const b = await signed();
    expect(a).not.toBe(b);
  });

  it('the derived key is deterministic for the same master key', async () => {
    const k1 = await deriveStateKey(MASTER, cryptoImpl);
    const k2 = await deriveStateKey(MASTER, cryptoImpl);
    const token = await signed();
    expect(await verifyState(token, k1, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: true });
    expect(await verifyState(token, k2, cryptoImpl, USER_A, NOW)).toMatchObject({ ok: true });
  });
});
