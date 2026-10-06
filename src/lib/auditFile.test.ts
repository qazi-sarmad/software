import { describe, it, expect } from 'vitest';
import {
  AUDIT_FILE_TABS,
  buildPlanningCoverage,
  getGateSummary,
  getInitialAuditFileTab,
  getSignOffState,
} from './auditFile';
import { AuditControl, AuditEngagement, Role, User, WorkingPaper } from '../types';

const eng = { id: 'ENG-1', entityId: 'ent-1' } as AuditEngagement;
const ctl = (id: string, entityId = 'ent-1'): AuditControl =>
  ({ id, entityId, engagementId: 'ENG-1', code: id, title: id, effectiveness: 'not_tested' } as AuditControl);
const wp = (id: string, controlId: string, sealed = false, engagementId = 'ENG-1'): WorkingPaper =>
  ({ id, controlId, engagementId, sealed, refCode: id } as WorkingPaper);
const userOf = (role: Role, id = `u-${role}`): User =>
  ({ id, name: role, role, email: '', avatar: '', universeIds: [], entityIds: [] });
const fullEng = (over: Partial<AuditEngagement> = {}): AuditEngagement =>
  ({ id: 'ENG-1', entityId: 'ent-1', status: 'in_progress', leadAuditorId: 'lead', stage: 'testing', ...over } as AuditEngagement);

describe('tabs', () => {
  it('has exactly planning, execution, review in order', () => {
    expect(AUDIT_FILE_TABS.map((t) => t.id)).toEqual(['planning', 'execution', 'review']);
  });
  it('opening from a comment lands on execution, otherwise planning', () => {
    expect(getInitialAuditFileTab({ workpaper: { id: 'w' } })).toBe('execution');
    expect(getInitialAuditFileTab({})).toBe('planning');
    expect(getInitialAuditFileTab(undefined)).toBe('planning');
  });
});

describe('buildPlanningCoverage', () => {
  it('lists only the entity controls and flags controls with no working paper', () => {
    const controls = [ctl('c1'), ctl('c2'), ctl('c3', 'ent-OTHER')];
    const wps = [wp('w1', 'c1', true), wp('w2', 'c1'), wp('w3', 'c2', false, 'ENG-OTHER')];
    const cov = buildPlanningCoverage(eng, controls, wps);
    expect(cov.rows.map((r) => r.control.id)).toEqual(['c1', 'c2']);
    expect(cov.controlCount).toBe(2);
    expect(cov.coveredCount).toBe(1);
    expect(cov.gapCount).toBe(1);
    expect(cov.rows[0]).toMatchObject({ gap: false, sealedCount: 1 });
    expect(cov.rows[0].workpapers.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(cov.rows[1].gap).toBe(true); // w3 belongs to another engagement
  });
  it('handles an entity with no controls', () => {
    const cov = buildPlanningCoverage(eng, [], []);
    expect(cov).toMatchObject({ rows: [], controlCount: 0, coveredCount: 0, gapCount: 0 });
  });
});

describe('getGateSummary', () => {
  it('counts sealed vs total', () => {
    expect(getGateSummary([wp('a', 'c', true), wp('b', 'c', false)])).toEqual({ total: 2, sealed: 1, unsealed: 1, allSealed: false });
    expect(getGateSummary([wp('a', 'c', true)]).allSealed).toBe(true);
  });
  it('zero papers is never "all sealed"', () => {
    expect(getGateSummary([])).toEqual({ total: 0, sealed: 0, unsealed: 0, allSealed: false });
  });
});

describe('getSignOffState', () => {
  const sealedGate = getGateSummary([wp('a', 'c', true)]);
  const openGate = getGateSummary([wp('a', 'c', true), wp('b', 'c', false)]);

  it.each(['preparer', 'reviewer', 'observer', 'auditee', 'org_admin'] as Role[])('%s cannot sign off even when all sealed', (role) => {
    const s = getSignOffState(userOf(role), fullEng(), sealedGate);
    expect(s.enabled).toBe(false);
    expect(s.reason).toBeTruthy();
  });
  it.each(['audit_manager', 'cia'] as Role[])('%s can sign off when all sealed', (role) => {
    expect(getSignOffState(userOf(role), fullEng(), sealedGate)).toEqual({ visible: true, enabled: true });
  });
  it('blocked with a count reason while papers are unsealed', () => {
    const s = getSignOffState(userOf('cia'), fullEng(), openGate);
    expect(s.enabled).toBe(false);
    expect(s.reason).toMatch(/1 working paper/);
  });
  it('blocked when there are no papers', () => {
    expect(getSignOffState(userOf('cia'), fullEng(), getGateSummary([])).enabled).toBe(false);
  });
  it('hidden once signed off; locked file is blocked', () => {
    expect(getSignOffState(userOf('cia'), fullEng({ status: 'signed_off' }), sealedGate).visible).toBe(false);
    expect(getSignOffState(userOf('cia'), fullEng({ isLocked: true }), sealedGate).enabled).toBe(false);
  });
});
