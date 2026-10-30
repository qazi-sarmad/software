// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  signPack, verifyPack, packContentHash, buildAdhocRule, runAdhocRule,
  type SignedRulePack,
} from './index';
import { justBelowThreshold } from './index';
import type { RulePack, SysteligonRule } from './types';

const crypto = webcrypto as unknown as Parameters<typeof signPack>[0];

let privateKey: JsonWebKey;
let publicKey: Uint8Array;

async function keypair(): Promise<{ priv: JsonWebKey; pub: Uint8Array }> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return { priv: jwk, pub: new Uint8Array(raw) };
}

beforeAll(async () => {
  const kp = await keypair();
  privateKey = kp.priv;
  publicKey = kp.pub;
});

function pack(rules: SysteligonRule[] = [justBelowThreshold as unknown as SysteligonRule]): RulePack {
  return { name: 'audit-default', version: 1, target: 'population', rules };
}

describe('signed rule packs (S11, spec §8)', () => {
  it('signs a pack and verifies it', async () => {
    const signed = await signPack(crypto, pack(), 'key-1', '2026-10-29T00:00:00Z', privateKey);
    expect(signed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const v = await verifyPack(crypto, signed, publicKey);
    expect(v.ok).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it('refuses a pack whose rules changed after signing, and gives the reason', async () => {
    const signed = await signPack(crypto, pack(), 'key-1', '2026-10-29T00:00:00Z', privateKey);
    const tampered: SignedRulePack = {
      ...signed,
      pack: { ...signed.pack, rules: [{ ...(signed.pack.rules[0]), severity: 'high' }] },
    };
    const v = await verifyPack(crypto, tampered, publicKey);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('content_changed');
    expect(v.reason).toMatch(/content hash/);
  });

  it('refuses a pack signed by a different key (signature invalid)', async () => {
    const other = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const otherPub = new Uint8Array((await webcrypto.subtle.exportKey('raw', other.publicKey)) as ArrayBuffer);
    const signed = await signPack(crypto, pack(), 'key-1', '2026-10-29T00:00:00Z', privateKey);
    const v = await verifyPack(crypto, signed, otherPub);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('signature_invalid');
  });

  it('refuses a signature whose subject names a different pack (defense in depth)', async () => {
    const signed = await signPack(crypto, pack(), 'key-1', '2026-10-29T00:00:00Z', privateKey);
    // Forge only the subject id; the content hash still matches, so the subject check is what fires.
    const forged: SignedRulePack = { ...signed, subject: { ...signed.subject, subjectId: 'other@9' } };
    const v = await verifyPack(crypto, forged, publicKey);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('subject_mismatch');
  });

  it('hashes a pack deterministically', async () => {
    expect(await packContentHash(pack())).toBe(await packContentHash(pack()));
  });
});

describe('adhoc rule builder (S10, spec §4)', () => {
  it('builds a versioned rule that runs through the same runner', () => {
    const spec = { id: 'adhoc.amount_over', version: 1, title: 'Amount over 1000', source: 'amount', condition: 'gt' as const, threshold: 1000, severity: 'medium' as const };
    const rows = [{ ref: 'r1', values: { amount: 1500 } }, { ref: 'r2', values: { amount: 500 } }];
    const result = runAdhocRule(spec, rows, '2026-10-29T00:00:00Z');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].refs).toEqual(['r1']);
    expect(result.findings[0].ruleId).toBe('adhoc.amount_over');
  });

  it('the built rule is a normal versioned rule, so it can be signed in a pack', async () => {
    const spec = { id: 'adhoc.missing_ref', version: 3, title: 'Missing reference', source: 'ref', condition: 'missing' as const, threshold: 0, severity: 'low' as const };
    const rule = buildAdhocRule(spec, 'draft');
    const signed = await signPack(crypto, { name: 'custom', version: 1, target: 'population', rules: [rule] }, 'key-1', '2026-10-29T00:00:00Z', privateKey);
    expect((await verifyPack(crypto, signed, publicKey)).ok).toBe(true);
  });
});
