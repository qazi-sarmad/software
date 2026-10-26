/**
 * A: integrity anchoring. Direct unit tests for the pure layer.
 *
 * Every test injects the time; nothing reads the clock. The Ed25519 tests use Node's own WebCrypto,
 * which is the same primitive the Edge Function uses, so the tests exercise the real code path.
 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  AnchorError, STAMP_BACKOFF_MINUTES, STAMP_MAX_ATTEMPTS, assertRootHash, canonicalSigningInput,
  checkTimestampToken, fromHex, signSubject, stampBackoffMinutes, stampStatus, timestampNonce,
  timestampRequestParts, toHex, verifySubject,
  type CryptoLike, type SignatureSubject,
} from './anchoring';

const crypto = webcrypto as unknown as CryptoLike;
const ROOT = 'a'.repeat(64);
const ROOT_B = 'b'.repeat(64);

function subject(over: Partial<SignatureSubject> = {}): SignatureSubject {
  return {
    kind: 'report_graph_root',
    subjectId: '60000000-0000-0000-0000-0000000000a1',
    rootHash: ROOT,
    signedAt: '2026-10-27T00:00:00Z',
    keyId: 'key-1',
    ...over,
  };
}

async function keypair(): Promise<{ priv: JsonWebKey; pub: Uint8Array }> {
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  )) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { priv: jwk, pub: new Uint8Array(raw) };
}

describe('canonical signing input', () => {
  it('is deterministic for the same subject', () => {
    expect(canonicalSigningInput(subject())).toBe(canonicalSigningInput(subject()));
  });

  it('sorts keys and carries every field', () => {
    const text = canonicalSigningInput(subject());
    expect(text).toBe('{"key_id":"key-1","kind":"report_graph_root","root_hash":"'
      + ROOT + '","signed_at":"2026-10-27T00:00:00Z","subject_id":"60000000-0000-0000-0000-0000000000a1"}');
  });

  it('changes when any single field changes', () => {
    const base = canonicalSigningInput(subject());
    expect(canonicalSigningInput(subject({ kind: 'board_pack_data_hash' }))).not.toBe(base);
    expect(canonicalSigningInput(subject({ subjectId: 'other' }))).not.toBe(base);
    expect(canonicalSigningInput(subject({ signedAt: '2026-10-27T00:00:01Z' }))).not.toBe(base);
    expect(canonicalSigningInput(subject({ keyId: 'key-2' }))).not.toBe(base);
    expect(canonicalSigningInput(subject({ rootHash: ROOT_B }))).not.toBe(base);
  });

  it('refuses a malformed root hash', () => {
    expect(() => canonicalSigningInput(subject({ rootHash: 'nope' }))).toThrow(AnchorError);
    expect(() => canonicalSigningInput(subject({ rootHash: 'A'.repeat(64) }))).toThrow(AnchorError);
    expect(() => assertRootHash('f'.repeat(63))).toThrow(AnchorError);
  });

  it('refuses a missing subject id, key id or time', () => {
    expect(() => canonicalSigningInput(subject({ subjectId: '' }))).toThrow(AnchorError);
    expect(() => canonicalSigningInput(subject({ keyId: '' }))).toThrow(AnchorError);
    expect(() => canonicalSigningInput(subject({ signedAt: '' }))).toThrow(AnchorError);
  });
});

describe('Ed25519 sign and verify', () => {
  it('round-trips a signature', async () => {
    const { priv, pub } = await keypair();
    const sig = await signSubject(crypto, subject(), priv);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifySubject(crypto, subject(), sig, pub)).toBe(true);
  });

  it('fails when one byte of the root hash is tampered with', async () => {
    const { priv, pub } = await keypair();
    const sig = await signSubject(crypto, subject(), priv);
    const tampered = subject({ rootHash: 'a'.repeat(63) + 'c' });
    expect(await verifySubject(crypto, tampered, sig, pub)).toBe(false);
  });

  it('fails when the subject id or time is changed', async () => {
    const { priv, pub } = await keypair();
    const sig = await signSubject(crypto, subject(), priv);
    expect(await verifySubject(crypto, subject({ subjectId: 'other' }), sig, pub)).toBe(false);
    expect(await verifySubject(crypto, subject({ signedAt: '2026-10-28T00:00:00Z' }), sig, pub)).toBe(false);
  });

  it('fails under a different key', async () => {
    const a = await keypair();
    const b = await keypair();
    const sig = await signSubject(crypto, subject(), a.priv);
    expect(await verifySubject(crypto, subject(), sig, b.pub)).toBe(false);
  });

  it('returns false for a malformed signature rather than throwing', async () => {
    const { pub } = await keypair();
    expect(await verifySubject(crypto, subject(), 'zz', pub)).toBe(false);
    expect(await verifySubject(crypto, subject(), 'abc', pub)).toBe(false);
  });
});

describe('RFC 3161 request derivation', () => {
  it('derives a deterministic nonce from the root hash and key id', () => {
    expect(timestampNonce(ROOT, 'key-1')).toBe(timestampNonce(ROOT, 'key-1'));
    expect(timestampNonce(ROOT, 'key-1')).not.toBe(timestampNonce(ROOT, 'key-2'));
    expect(timestampNonce(ROOT, 'key-1')).not.toBe(timestampNonce(ROOT_B, 'key-1'));
  });

  it('produces a positive integer nonce that is never zero', () => {
    const nonce = timestampNonce(ROOT, 'key-1');
    expect(nonce).toMatch(/^[0-9a-f]+$/);
    expect(BigInt('0x' + nonce) > 0n).toBe(true);
    expect(BigInt('0x' + nonce) < 2n ** 63n).toBe(true);
  });

  it('builds the request parts with the imprint, certReq and no document', () => {
    const parts = timestampRequestParts({ rootHash: ROOT, keyId: 'key-1' });
    expect(parts).toEqual({
      version: 1,
      messageImprintAlgorithm: 'sha256',
      messageImprint: ROOT,
      nonce: timestampNonce(ROOT, 'key-1'),
      certReq: true,
    });
    // L2: only the hash is carried. No field can hold tenant content.
    expect(Object.values(parts).some((v) => typeof v === 'string' && v.length > 64)).toBe(false);
  });

  it('refuses a malformed root hash', () => {
    expect(() => timestampRequestParts({ rootHash: 'short', keyId: 'k' })).toThrow(AnchorError);
  });
});

describe('timestamp token checks', () => {
  const validity = { notBefore: '2020-01-01T00:00:00Z', notAfter: '2030-01-01T00:00:00Z' };
  const facts = (over = {}) => ({
    messageImprint: ROOT, genTime: '2026-10-27T00:00:00Z', tsaCertificate: 'deadbeef',
    chainValid: true, anchorId: 'anchor-1', ...over,
  });

  it('accepts a token with a matching imprint, valid chain and in-window time', () => {
    expect(checkTimestampToken(facts(), ROOT, validity, '2026-10-27T00:00:00Z')).toEqual({ ok: true });
  });

  it('refuses an imprint mismatch', () => {
    const r = checkTimestampToken(facts({ messageImprint: ROOT_B }), ROOT, validity, '2026-10-27T00:00:00Z');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/imprint/);
  });

  it('refuses an invalid chain or a missing anchor', () => {
    expect(checkTimestampToken(facts({ chainValid: false }), ROOT, validity, '2026-10-27T00:00:00Z').ok).toBe(false);
    expect(checkTimestampToken(facts({ anchorId: null }), ROOT, validity, '2026-10-27T00:00:00Z').ok).toBe(false);
  });

  it('refuses a signing time outside the certificate window', () => {
    const r = checkTimestampToken(facts({ genTime: '2019-01-01T00:00:00Z' }), ROOT, validity, '2026-10-27T00:00:00Z');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/validity window/);
  });

  it('refuses an expired certificate', () => {
    const expired = { notBefore: '2019-01-01T00:00:00Z', notAfter: '2020-01-01T00:00:00Z' };
    expect(checkTimestampToken(facts(), ROOT, expired, '2026-10-27T00:00:00Z').ok).toBe(false);
  });

  it('refuses a malformed instant', () => {
    expect(checkTimestampToken(facts({ genTime: 'not-a-date' }), ROOT, validity, '2026-10-27T00:00:00Z').ok).toBe(false);
  });
});

describe('stamp status and backoff', () => {
  it('reports stamped when the minimum is met', () => {
    expect(stampStatus(2, 3, 2)).toBe('stamped');
    expect(stampStatus(3, 3, 2)).toBe('stamped');
  });

  it('reports partial when one authority succeeded but not the minimum', () => {
    expect(stampStatus(1, 2, 2)).toBe('partial');
  });

  it('reports failed when every attempt failed and queued when none ran', () => {
    expect(stampStatus(0, 2, 2)).toBe('failed');
    expect(stampStatus(0, 0, 2)).toBe('queued');
  });

  it('walks the backoff ladder and stops at the cap', () => {
    expect(stampBackoffMinutes(0)).toBe(1);
    expect(stampBackoffMinutes(1)).toBe(5);
    expect(stampBackoffMinutes(2)).toBe(15);
    expect(stampBackoffMinutes(3)).toBe(60);
    expect(stampBackoffMinutes(4)).toBe(240);
    expect(stampBackoffMinutes(5)).toBe(240);
    expect(stampBackoffMinutes(STAMP_MAX_ATTEMPTS)).toBeNull();
    expect(stampBackoffMinutes(99)).toBeNull();
  });

  it('documents the ladder', () => {
    expect(STAMP_BACKOFF_MINUTES).toEqual([1, 5, 15, 60, 240]);
  });
});

describe('hex helpers', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(toHex(bytes)).toBe('00010f10ff');
    expect(Array.from(fromHex('00010f10ff'))).toEqual([0, 1, 15, 16, 255]);
  });

  it('refuses an odd-length hex string', () => {
    expect(() => fromHex('abc')).toThrow(AnchorError);
  });
});
