import { describe, expect, it } from 'vitest';
import {
  APPROVED_STATES, applyApprovalGate, approvalFor, checkStaleness, isClaimStale,
  observationContentHash, type Observation, type ObservationState,
} from './observations';
import { fixtureClaims } from './fixtures';
import type { Claim, ClaimApproval } from './types';

function obs(id: string, state: ObservationState, over: Partial<Observation> = {}): Observation {
  const base: Omit<Observation, 'contentHash'> = {
    id,
    orgId: 'org-a',
    engagementId: 'eng-1',
    title: `Observation ${id}`,
    state,
    sections: { condition: 'x', criteria: 'y' },
    version: 1,
    approval: APPROVED_STATES.includes(state)
      ? { approvedBy: 'mgr', approvedAt: '2026-10-20T00:00:00Z', version: 1, contentHash: 'a'.repeat(64) }
      : null,
    ...over,
  };
  return { ...base, contentHash: over.contentHash ?? 'a'.repeat(64) };
}

describe('W3.2 the approved-observation gate', () => {
  it('admits only approved and finding states that carry an approval record', () => {
    const gate = applyApprovalGate([
      obs('o1', 'approved'),
      obs('o2', 'finding'),
      obs('o3', 'draft'),
      obs('o4', 'submitted'),
      obs('o5', 'in_review'),
      obs('o6', 'rejected'),
      obs('o7', 'reopened'),
    ]);
    expect(gate.admitted.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(gate.excluded.map((e) => e.observationId)).toEqual(['o3', 'o4', 'o5', 'o6', 'o7']);
  });

  it('excludes an approved state that carries no approval record', () => {
    const gate = applyApprovalGate([obs('o1', 'approved', { approval: null })]);
    expect(gate.admitted).toEqual([]);
    expect(gate.excluded[0].reason).toBe('Not approved.');
  });

  it('gives every excluded observation a plain reason a reader can act on', () => {
    const gate = applyApprovalGate([
      obs('o1', 'draft'), obs('o2', 'submitted'), obs('o3', 'in_review'),
      obs('o4', 'rejected'), obs('o5', 'reopened'),
    ]);
    const reasons = Object.fromEntries(gate.excluded.map((e) => [e.observationId, e.reason]));
    expect(reasons.o1).toMatch(/Draft/);
    expect(reasons.o2).toMatch(/awaiting review/);
    expect(reasons.o3).toMatch(/not yet approved/);
    expect(reasons.o4).toMatch(/did not approve/);
    expect(reasons.o5).toMatch(/approval was withdrawn/);
  });

  it('honours a caller-supplied reason over the default', () => {
    const gate = applyApprovalGate([obs('o1', 'rejected', { reason: 'Outside the audit scope.' })]);
    expect(gate.excluded[0].reason).toBe('Outside the audit scope.');
  });

  it('orders admitted and excluded deterministically by id', () => {
    const gate = applyApprovalGate([obs('z', 'approved'), obs('a', 'approved'), obs('m', 'draft'), obs('b', 'draft')]);
    expect(gate.admitted.map((o) => o.id)).toEqual(['a', 'z']);
    expect(gate.excluded.map((e) => e.observationId)).toEqual(['b', 'm']);
  });

  it('hashes the observation content over its sections in sorted key order', async () => {
    const a = await observationContentHash({
      id: 'o1', orgId: 'org-a', engagementId: 'e', title: 't', state: 'draft',
      sections: { b: '2', a: '1' }, version: 1, approval: null,
    });
    const b = await observationContentHash({
      id: 'o1', orgId: 'org-a', engagementId: 'e', title: 't', state: 'draft',
      sections: { a: '1', b: '2' }, version: 1, approval: null,
    });
    expect(a).toBe(b);
    const changed = await observationContentHash({
      id: 'o1', orgId: 'org-a', engagementId: 'e', title: 't', state: 'draft',
      sections: { a: '1', b: '3' }, version: 1, approval: null,
    });
    expect(changed).not.toBe(a);
  });

  it('flags a claim stale when its observation is missing', () => {
    const claim: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    expect(isClaimStale(claim, new Map())).toBe(true);
  });

  it('flags a claim stale when the observation content hash changed', () => {
    const claim: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    const changed = obs('o1', 'approved', { contentHash: 'c'.repeat(64) });
    expect(isClaimStale(claim, new Map([['o1', changed]]))).toBe(true);
  });

  it('flags a claim stale when the observation version moved', () => {
    const claim: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    const bumped = obs('o1', 'approved', { version: 2 });
    expect(isClaimStale(claim, new Map([['o1', bumped]]))).toBe(true);
  });

  it('flags a claim stale when the observation was reopened', () => {
    const claim: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    expect(isClaimStale(claim, new Map([['o1', obs('o1', 'reopened')]]))).toBe(true);
  });

  it('does not flag a claim with no approval, or one whose observation still matches', () => {
    const bare: Claim = { ...fixtureClaims()[0], approval: null };
    expect(isClaimStale(bare, new Map())).toBe(false);
    const claim: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    expect(isClaimStale(claim, new Map([['o1', obs('o1', 'approved')]]))).toBe(false);
  });

  it('blocks the freeze and names every stale claim and reopened observation', () => {
    const c1: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    const c2: Claim = { ...fixtureClaims()[1], approval: approval('o2', 'a'.repeat(64), 1) };
    const report = checkStaleness([c1, c2], new Map([['o1', obs('o1', 'approved')]]));
    expect(report.blocked).toBe(true);
    expect(report.staleClaims).toEqual([c2.id]);
    expect(report.reopenedObservations).toEqual(['o2']);
  });

  it('does not block when every approved observation still matches', () => {
    const c1: Claim = { ...fixtureClaims()[0], approval: approval('o1', 'a'.repeat(64), 1) };
    const report = checkStaleness([c1], new Map([['o1', obs('o1', 'approved')]]));
    expect(report.blocked).toBe(false);
    expect(report.staleClaims).toEqual([]);
  });

  it('refuses to take an approval from an unapproved observation', () => {
    expect(() => approvalFor(obs('o1', 'draft'))).toThrow(/not approved/);
  });
});

function approval(observationId: string, contentHash: string, version: number): ClaimApproval {
  return {
    observationId, approvedBy: 'mgr', approvedAt: '2026-10-20T00:00:00Z',
    observationVersion: version, contentHash,
  };
}
