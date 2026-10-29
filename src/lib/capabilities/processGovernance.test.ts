import { describe, expect, it } from 'vitest';
import {
  delegationOfAuthorityBreach,
  meetingGovernance,
  policyExceptionRegister,
  regulatoryChangeImpact,
  segregationOfDuties,
  SOD_RULES,
  type ApprovalRecord,
  type DelegationLimit,
  type MeetingRecord,
  type PolicyException,
  type PolicyReference,
  type PrincipalRights,
  type Regulation,
} from './processGovernance';

describe('D3 — process and governance intelligence', () => {
  it('segregationOfDuties flags a principal that holds a forbidden pair', () => {
    const principals: PrincipalRights[] = [
      { id: 'r1', label: 'Audit Manager', rights: { perform_work: true, review_and_approve: true } },
      { id: 'r2', label: 'Preparer', rights: { perform_work: true } },
    ];
    const m = segregationOfDuties(principals);
    expect(m.clean).toBe(false);
    expect(m.conflictedPrincipals).toEqual(['r1']);
    expect(m.conflicts[0].ruleId).toBe('sod.perform_review');
    expect(m.conflicts[0].reason).toContain('independent review');
  });

  it('segregationOfDuties is clean when no principal holds a conflicting pair', () => {
    const m = segregationOfDuties([{ id: 'r1', label: 'Preparer', rights: { perform_work: true } }]);
    expect(m.clean).toBe(true);
    expect(m.conflicts).toEqual([]);
  });

  it('segregationOfDuties catches the admin+work and role+user combinations', () => {
    const principals: PrincipalRights[] = [
      { id: 'a', label: 'A', rights: { manage_users: true, perform_work: true, manage_roles: true } },
    ];
    const m = segregationOfDuties(principals);
    const rules = m.conflicts.map((c) => c.ruleId).sort();
    expect(rules).toEqual(['sod.admin_roles', 'sod.admin_work']);
    expect(SOD_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it('delegationOfAuthorityBreach reports the amount over the limit, worst first', () => {
    const limits: DelegationLimit[] = [
      { principalId: 'p1', label: 'Manager', limitCents: 100_000 },
      { principalId: 'p2', label: 'Clerk', limitCents: 10_000 },
    ];
    const approvals: ApprovalRecord[] = [
      { id: 'a1', principalId: 'p1', amountCents: 120_000, subject: 'PO 1' },
      { id: 'a2', principalId: 'p2', amountCents: 50_000, subject: 'PO 2' },
      { id: 'a3', principalId: 'p1', amountCents: 90_000, subject: 'PO 3' },
    ];
    const res = delegationOfAuthorityBreach(limits, approvals);
    expect(res.clean).toBe(false);
    expect(res.breaches.map((b) => b.approvalId)).toEqual(['a2', 'a1']);
    expect(res.breaches[0].overByCents).toBe(40_000);
  });

  it('delegationOfAuthorityBreach counts approvals by a principal with no limit', () => {
    const res = delegationOfAuthorityBreach([], [{ id: 'a1', principalId: 'px', amountCents: 999, subject: 'X' }]);
    expect(res.unlimitedApprovals).toBe(1);
    expect(res.breaches).toEqual([]);
    expect(res.clean).toBe(true);
  });

  it('policyExceptionRegister marks expiry as at asOf and lists expired first', () => {
    const exceptions: PolicyException[] = [
      { id: 'x1', policy: 'Travel', grantedTo: 'u1', grantedBy: 'u2', grantedAt: '2026-01-01', expiresAt: '2026-06-01' },
      { id: 'x2', policy: 'Procurement', grantedTo: 'u3', grantedBy: 'u2', grantedAt: '2026-01-01', expiresAt: '2026-12-01' },
      { id: 'x3', policy: 'IT', grantedTo: 'u4', grantedBy: 'u2', grantedAt: '2026-01-01', expiresAt: null },
    ];
    const reg = policyExceptionRegister(exceptions, '2026-10-01');
    expect(reg.expired.map((r) => r.id)).toEqual(['x1']);
    expect(reg.expired[0].daysToExpiry).toBeLessThan(0);
    expect(reg.active.map((r) => r.id).sort()).toEqual(['x2', 'x3']);
  });

  it('meetingGovernance scores quorum, actions and prior-action closure', () => {
    const meetings: MeetingRecord[] = [
      { id: 'm1', title: 'Jan', date: '2026-01-10', membersExpected: 6, membersPresent: 5, actionsAssigned: 2, priorActionsTotal: 0, priorActionsClosed: 0 },
      { id: 'm2', title: 'Feb', date: '2026-02-10', membersExpected: 6, membersPresent: 2, actionsAssigned: 0, priorActionsTotal: 4, priorActionsClosed: 1 },
    ];
    const g = meetingGovernance(meetings);
    expect(g.rows[0].score).toBe(3); // quorum + actions + nothing to close
    expect(g.rows[1].score).toBe(0); // no quorum, no actions, prior actions open
    expect(g.failingQuorum).toEqual(['m2']);
    expect(g.averageScore).toBe(1.5);
  });

  it('regulatoryChangeImpact finds policies aligned to an older regulation version', () => {
    const regs: Regulation[] = [
      { id: 'reg1', title: 'AML', version: 'v3', effectiveFrom: '2026-09-01' },
      { id: 'reg2', title: 'GDPR', version: 'v2', effectiveFrom: '2026-01-01' },
    ];
    const policies: PolicyReference[] = [
      { id: 'p1', title: 'AML Policy', regulationId: 'reg1', alignedVersion: 'v2', lastReviewedAt: '2026-01-01' },
      { id: 'p2', title: 'Privacy Policy', regulationId: 'reg2', alignedVersion: 'v2', lastReviewedAt: '2026-01-01' },
    ];
    const impact = regulatoryChangeImpact(regs, policies);
    expect(impact.clean).toBe(false);
    expect(impact.stale.map((r) => r.policyId)).toEqual(['p1']);
    expect(impact.stale[0].currentVersion).toBe('v3');
  });

  it('regulatoryChangeImpact is clean when every policy matches the version in force', () => {
    const impact = regulatoryChangeImpact(
      [{ id: 'reg1', title: 'AML', version: 'v3', effectiveFrom: '2026-09-01' }],
      [{ id: 'p1', title: 'AML Policy', regulationId: 'reg1', alignedVersion: 'v3', lastReviewedAt: null }]
    );
    expect(impact.clean).toBe(true);
    expect(impact.stale).toEqual([]);
  });
});
