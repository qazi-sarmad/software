import { describe, expect, it } from 'vitest';
import { deriveEngagementGraph, severityRank, type ReportRecordSet } from './derive';
import { ENGINE_VERSION } from './fixtures';
import { DEFAULT_REGISTER } from './registers';
import { claimCanonical } from './graph';
import { buildMerkleTree } from './merkle';

const RECORDS: ReportRecordSet = {
  engagementId: 'eng-1',
  findings: [{ id: 'f-1', severity: 'High' }, { id: 'f-2', severity: null }],
  controlsTested: 12,
  controlsWithExceptions: 2,
  itemsTested: 25,
  sampleExceptions: 3,
  exceptionValueMinor: 125000,
  caps: [{ id: 'cap-1', status: 'open' }],
};

describe('deriveEngagementGraph (2.6)', () => {
  it('is pure: the same records derive the same root', async () => {
    const a = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    const b = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    expect(a.graphRoot).toBe(b.graphRoot);
  });

  it('changing a record changes the graph root', async () => {
    const a = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    const b = await deriveEngagementGraph(
      { ...RECORDS, sampleExceptions: 4 }, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    expect(b.graphRoot).not.toBe(a.graphRoot);
  });

  it('the root is the Merkle root over the canonical claims', async () => {
    const derived = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    const tree = await buildMerkleTree(derived.claims.map((c) => c.canonical));
    expect(derived.graphRoot).toBe(tree.root);
  });

  it('records the reference hashes the database re-verifies', async () => {
    const derived = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    const condition = derived.claims.find((c) => c.claim.id === 'c-condition');
    expect(condition?.claim.references.map((r) => r.id)).toEqual(['f-1', 'f-2']);
    expect(condition?.claim.references[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('omits the effect claim when no value was identified', async () => {
    const derived = await deriveEngagementGraph(
      { ...RECORDS, exceptionValueMinor: 0 }, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    expect(derived.claims.some((c) => c.claim.id === 'c-effect')).toBe(false);
  });

  it('produces a canonical form the writer can hash', async () => {
    const derived = await deriveEngagementGraph(RECORDS, DEFAULT_REGISTER, 'en-GB', ENGINE_VERSION);
    for (const c of derived.claims) {
      expect(c.canonical).toBe(claimCanonical(c.claim));
      expect(c.claimHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('ranks severities with an unknown severity last', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'));
    expect(severityRank(null)).toBeGreaterThan(severityRank('low'));
  });
});
