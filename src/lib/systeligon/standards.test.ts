// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  buildStandardsPack, standardsPackContentHash, signStandardsPack, verifyStandardsPack,
  standardsPackDef, STANDARDS_CATALOGUE, effectiveSubscription, toStandardsRule,
  type SignedStandardsPack, type StandardsSubscription,
} from './standards';
import { justBelowThreshold } from './rules/threshold';
import { structuralRules } from './rules/structural';
import { ENGINE_NAME } from '../product';
import type { SysteligonRule } from './types';

const crypto = webcrypto as unknown as Parameters<typeof signStandardsPack>[0];

let privateKey: JsonWebKey;
let publicKey: Uint8Array;

beforeAll(async () => {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const jwk = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  privateKey = jwk;
  publicKey = new Uint8Array(raw);
});

/** A small released library so the pack build is exercised without the whole engine. */
const library: SysteligonRule[] = [
  { ...(justBelowThreshold as unknown as SysteligonRule), status: 'released' },
  ...structuralRules.map((r) => ({ ...r, status: 'released' as const })),
];

describe('standards packs (D16, spec §2/§4)', () => {
  it('builds a pack from the shipped library for the pack scopes only', () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const pack = buildStandardsPack(def, 1, library);
    expect(pack.packId).toBe('standards.forensic.core');
    expect(pack.version).toBe(1);
    // Every rule's target is one of the pack's scopes, and none is a draft.
    for (const r of pack.rules) {
      expect(def.scopes).toContain(r.appliesTo);
      expect(r.status).toBe('released');
    }
    expect(pack.rules.length).toBe(library.filter((r) => r.status === 'released').length);
  });

  it('excludes a draft rule — a draft never ships', () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const withDraft: SysteligonRule[] = [...library, { ...(justBelowThreshold as unknown as SysteligonRule), id: 'draft.rule', status: 'draft' }];
    const pack = buildStandardsPack(def, 1, withDraft);
    expect(pack.rules.some((r) => r.id === 'draft.rule')).toBe(false);
  });

  it('refuses a version below 1', () => {
    const def = standardsPackDef('standards.forensic.core')!;
    expect(() => buildStandardsPack(def, 0, library)).toThrow();
  });

  it('produces the same content hash for the same content and a different one when a rule changes', async () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const a = await standardsPackContentHash(buildStandardsPack(def, 1, library));
    const b = await standardsPackContentHash(buildStandardsPack(def, 1, library));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const changed = buildStandardsPack(def, 1, [
      { ...(justBelowThreshold as unknown as SysteligonRule), status: 'released', severity: 'high' },
      ...structuralRules.map((r) => ({ ...r, status: 'released' as const })),
    ]);
    expect(await standardsPackContentHash(changed)).not.toBe(a);
  });

  it('changes the hash when a source edition changes', async () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const base = buildStandardsPack(def, 1, library);
    const moved = { ...base, sources: [{ doc: `${ENGINE_NAME} engine`, edition: '2027' }] };
    expect(await standardsPackContentHash(moved)).not.toBe(await standardsPackContentHash(base));
  });

  it('signs a pack and verifies it', async () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const pack = buildStandardsPack(def, 1, library);
    const signed = await signStandardsPack(crypto, pack, 'plat-key-1', '2026-10-30T00:00:00Z', privateKey);
    expect(signed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const v = await verifyStandardsPack(crypto, signed, publicKey);
    expect(v.ok).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it('refuses a pack whose rules changed after signing, with the exact reason', async () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const signed = await signStandardsPack(crypto, buildStandardsPack(def, 1, library), 'k', '2026-10-30T00:00:00Z', privateKey);
    const tampered: SignedStandardsPack = {
      ...signed,
      pack: { ...signed.pack, rules: signed.pack.rules.map((r, i) => (i === 0 ? { ...r, severity: 'high' } : r)) },
    };
    const v = await verifyStandardsPack(crypto, tampered, publicKey);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('content_changed');
    expect(v.reason).toContain('content hash does not match');
  });

  it('refuses a pack signed for a different subject', async () => {
    const def = standardsPackDef('standards.forensic.core')!;
    const signed = await signStandardsPack(crypto, buildStandardsPack(def, 1, library), 'k', '2026-10-30T00:00:00Z', privateKey);
    const moved: SignedStandardsPack = {
      ...signed,
      pack: { ...signed.pack, version: 2 },
      contentHash: await standardsPackContentHash({ ...signed.pack, version: 2 }),
      subject: { ...signed.subject, rootHash: await standardsPackContentHash({ ...signed.pack, version: 2 }) },
    };
    const v = await verifyStandardsPack(crypto, moved, publicKey);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('subject_mismatch');
  });

  it('refuses a signature that is not valid for the stated key', async () => {
    const other = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const otherRaw = new Uint8Array((await webcrypto.subtle.exportKey('raw', other.publicKey)) as ArrayBuffer);
    const def = standardsPackDef('standards.forensic.core')!;
    const signed = await signStandardsPack(crypto, buildStandardsPack(def, 1, library), 'k', '2026-10-30T00:00:00Z', privateKey);
    const v = await verifyStandardsPack(crypto, signed, otherRaw);
    expect(v.ok).toBe(false);
    expect(v.refusal).toBe('signature_invalid');
  });
});

describe('the standards catalogue (D16, spec §2)', () => {
  it('declares every pack the spec names, once, with a source each', () => {
    const ids = STANDARDS_CATALOGUE.map((d) => d.packId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'standards.forensic.core', 'standards.icfr.sox', 'standards.it.baseline',
      'standards.shariah.aaoifi', 'standards.shariah.sbp-compendium', 'standards.shariah.sgf',
      'standards.risk.pwc-taxonomy',
    ]) expect(ids).toContain(id);
    for (const d of STANDARDS_CATALOGUE) expect(d.sources.length).toBeGreaterThan(0);
  });

  it('marks only the forensic core as shipped, because only it has released rules', () => {
    const shipped = STANDARDS_CATALOGUE.filter((d) => d.shipped).map((d) => d.packId);
    expect(shipped).toEqual(['standards.forensic.core']);
  });

  it('projects a rule into the stored shape', () => {
    const r = toStandardsRule({ ...(justBelowThreshold as unknown as SysteligonRule), status: 'released' });
    expect(r.id).toBe(justBelowThreshold.id);
    expect(r.kind).toBe(justBelowThreshold.kind);
    expect(r.status).toBe('released');
  });
});

describe('effective subscription (D16, spec §3.3)', () => {
  const rows: StandardsSubscription[] = [
    { packId: 'p', version: 1, pinned: false, reason: null, appliedAt: '2026-01-01T00:00:00Z' },
    { packId: 'p', version: 2, pinned: true, reason: 'frozen', appliedAt: '2026-02-01T00:00:00Z' },
    { packId: 'q', version: 5, pinned: false, reason: null, appliedAt: '2026-03-01T00:00:00Z' },
  ];
  it('returns the newest applied version for a pack', () => {
    expect(effectiveSubscription(rows, 'p')?.version).toBe(2);
    expect(effectiveSubscription(rows, 'q')?.version).toBe(5);
  });
  it('returns undefined for a pack the tenant does not run', () => {
    expect(effectiveSubscription(rows, 'z')).toBeUndefined();
  });
});
