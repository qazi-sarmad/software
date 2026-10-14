import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HashUnavailableError,
  appendLedgerEntry,
  computePayloadHash,
  computeSha256,
  isSecureHashAvailable,
  verifyChain,
} from './ledger';
import { buildDemoLedger } from '../data/demoSeed';

const baseEntry = {
  actorId: 'usr-x',
  actorName: 'Test User',
  actorRole: 'preparer' as const,
  eventType: 'test_finalize' as const,
  entityId: 'ent-x',
  recordId: 'rec-x',
  recordType: 'workpaper' as const,
  payloadSummary: 'summary',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ledger hashing never falls back to a non-cryptographic hash (Law 5)', () => {
  it('computes real SHA-256 when crypto.subtle is available (known vectors)', async () => {
    expect(isSecureHashAvailable()).toBe(true);
    expect(await computeSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await computeSha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('refuses to hash when crypto is missing entirely', async () => {
    vi.stubGlobal('crypto', undefined);
    expect(isSecureHashAvailable()).toBe(false);
    await expect(computeSha256('abc')).rejects.toBeInstanceOf(HashUnavailableError);
    await expect(computeSha256('abc')).rejects.toMatchObject({ code: 'HASH_UNAVAILABLE' });
  });

  it('refuses to hash when crypto exists but crypto.subtle is missing', async () => {
    vi.stubGlobal('crypto', { getRandomValues: () => undefined });
    expect(isSecureHashAvailable()).toBe(false);
    await expect(computeSha256('abc')).rejects.toBeInstanceOf(HashUnavailableError);
  });

  it('refuses to hash when crypto.subtle has no digest function', async () => {
    vi.stubGlobal('crypto', { subtle: {} });
    expect(isSecureHashAvailable()).toBe(false);
    await expect(computeSha256('abc')).rejects.toBeInstanceOf(HashUnavailableError);
  });

  it('returns no weak hash: the error carries no hash-like value', async () => {
    vi.stubGlobal('crypto', undefined);
    let value: unknown = 'unset';
    try {
      value = await computeSha256('abc');
    } catch (err) {
      expect((err as Error).message).toMatch(/Nothing was sealed/);
    }
    expect(value).toBe('unset');
  });

  it('computePayloadHash and appendLedgerEntry refuse to seal and append nothing', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(computePayloadHash({ a: 1 })).rejects.toBeInstanceOf(HashUnavailableError);
    const chain: any[] = [];
    await expect(appendLedgerEntry(chain, baseEntry)).rejects.toBeInstanceOf(HashUnavailableError);
    expect(chain).toHaveLength(0);
  });

  it('buildDemoLedger refuses to build a ledger without secure hashing', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(buildDemoLedger()).rejects.toBeInstanceOf(HashUnavailableError);
  });

  it('verifyChain never reports a chain as valid when it cannot be checked', async () => {
    const chain = [await appendLedgerEntry([], baseEntry)];
    expect((await verifyChain(chain)).valid).toBe(true);
    vi.stubGlobal('crypto', undefined);
    const result = await verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/crypto\.subtle/);
  });

  it('the source contains no non-cryptographic hash fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/lib/ledger.ts'), 'utf-8');
    expect(src).not.toMatch(/hash\s*<<\s*5/);
    expect(src).not.toMatch(/Math\.abs\(hash\)/);
  });
});
