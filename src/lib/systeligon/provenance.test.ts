// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findingsToClaims, findingToClaim } from './provenance';
import { claimHash } from '../writing/graph';
import type { RuleFinding } from './types';

const finding: RuleFinding = {
  ruleId: 'numeric.duplicates', ruleVersion: 3, kind: 'duplicates', severity: 'high',
  reason: 'Two rows share the invoice number INV-001.', refs: ['row-7', 'row-9'],
};

describe('S13 findings-to-report provenance (§9.4)', () => {
  it('copies the rule id and version onto the claim, never inventing them', async () => {
    const { claim, ruleId, ruleVersion } = await findingToClaim(finding, 0);
    expect(claim.ruleId).toBe('numeric.duplicates');
    expect(claim.ruleVersion).toBe(3);
    expect(ruleId).toBe('numeric.duplicates');
    expect(ruleVersion).toBe(3);
    expect(claim.phraseId).toBe('findings.rule_finding');
    expect(claim.sectionId).toBe('findings');
  });

  it('cites every flagged row as a reference', async () => {
    const { claim, referenceIds } = await findingToClaim(finding, 0);
    expect(claim.references.map((r) => r.id).sort()).toEqual(['row-7', 'row-9']);
    expect(referenceIds).toEqual(['row-7', 'row-9']);
    expect(claim.references.every((r) => r.contentHash.length === 64)).toBe(true);
  });

  it('a changed rule version changes the claim hash — a re-run is provable', async () => {
    const base = await findingToClaim(finding, 0);
    const bumped = await findingToClaim({ ...finding, ruleVersion: 4 }, 0);
    expect(await claimHash(base.claim)).not.toBe(await claimHash(bumped.claim));
  });

  it('a changed flagged row changes the claim hash — the root follows the evidence', async () => {
    const base = await findingToClaim(finding, 0);
    const moved = await findingToClaim({ ...finding, refs: ['row-7', 'row-10'] }, 0);
    expect(await claimHash(base.claim)).not.toBe(await claimHash(moved.claim));
  });

  it('the same finding twice hashes the same — deterministic', async () => {
    const a = await findingToClaim(finding, 0);
    const b = await findingToClaim(finding, 0);
    expect(await claimHash(a.claim)).toBe(await claimHash(b.claim));
  });

  it('an empty run yields no claims and no rules', async () => {
    expect(await findingsToClaims([])).toEqual({ claims: [], rules: [] });
  });

  it('records each rule once at its newest version, ordered by id', async () => {
    const set = await findingsToClaims([
      finding,
      { ...finding, ruleVersion: 5 },
      { ...finding, ruleId: 'benford.first_digit', kind: 'benford', ruleVersion: 1 },
    ]);
    expect(set.rules).toEqual([
      { ruleId: 'benford.first_digit', ruleVersion: 1 },
      { ruleId: 'numeric.duplicates', ruleVersion: 5 },
    ]);
    expect(set.claims).toHaveLength(3);
  });
});
