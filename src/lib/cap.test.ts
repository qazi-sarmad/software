import { describe, expect, it } from 'vitest';
import { transitionCapStatus } from './cap';
import { buildDefaultOrgRoleConfig, canPerformCapability } from './orgCapabilities';
import { AuditCapItem, CapCapability, OrgRoleConfig, Role, User } from '../types';

const user = (role: Role, id?: string): User => ({
  id: id ?? `u-${role}`,
  name: role,
  email: `${role}@x`,
  avatar: '',
  role,
  universeIds: [],
  entityIds: [],
});

const baseCap = (over: Partial<AuditCapItem> = {}): AuditCapItem => ({
  id: 'cap-1',
  action: 'Fix control',
  title: 'CAP',
  owner: 'Owner',
  department: 'Treasury',
  severity: 'high',
  dueDate: '2026-10-01',
  status: 'Open',
  retestStatus: 'Not tested',
  identifiedDate: '2026-09-01',
  entityId: 'e1',
  engagementId: 'eng1',
  ...over,
});

const defaults = buildDefaultOrgRoleConfig();

describe('default capability matrix', () => {
  it('preparer can submit, cannot verify', () => {
    expect(canPerformCapability(user('preparer'), 'cap_submit_validation', defaults).allowed).toBe(true);
    expect(canPerformCapability(user('preparer'), 'cap_verify_close', defaults).allowed).toBe(false);
  });
  it('reviewer can verify, cannot change due date', () => {
    expect(canPerformCapability(user('reviewer'), 'cap_verify_close', defaults).allowed).toBe(true);
    expect(canPerformCapability(user('reviewer'), 'cap_change_due_date', defaults).allowed).toBe(false);
  });
  it('cia and audit_manager can fail retest and change due date', () => {
    expect(canPerformCapability(user('cia'), 'cap_fail_retest', defaults).allowed).toBe(true);
    expect(canPerformCapability(user('audit_manager'), 'cap_change_due_date', defaults).allowed).toBe(true);
  });
});

describe('org config override', () => {
  it('grants verify to a custom designation on a preparer user', () => {
    const config: OrgRoleConfig = {
      ...defaults,
      designations: [
        ...defaults.designations,
        { id: 'des-custom-verifier', label: 'Special Verifier', capabilities: ['cap_verify_close', 'cap_reject'] },
      ],
      userDesignationIds: { 'u-prep-custom': ['des-custom-verifier'] },
    };
    const u = user('preparer', 'u-prep-custom');
    expect(canPerformCapability(u, 'cap_verify_close', config).allowed).toBe(true);
    expect(canPerformCapability(user('preparer', 'u-other'), 'cap_verify_close', config).allowed).toBe(false);
  });
});

describe('transitionCapStatus', () => {
  it('denies preparer verify_close', () => {
    const r = transitionCapStatus({
      cap: baseCap({ status: 'Pending validation' }),
      action: 'verify_close',
      user: user('preparer'),
      orgConfig: defaults,
    });
    expect(r.ok).toBe(false);
  });

  it('submit requires justification and evidence', () => {
    const noNote = transitionCapStatus({
      cap: baseCap(),
      action: 'submit_validation',
      user: user('preparer'),
      orgConfig: defaults,
      note: 'short',
      evidenceRefs: ['ev-1'],
    });
    expect(noNote.ok).toBe(false);

    const noEv = transitionCapStatus({
      cap: baseCap(),
      action: 'submit_validation',
      user: user('preparer'),
      orgConfig: defaults,
      note: 'Sufficient justification text',
      evidenceRefs: [],
    });
    expect(noEv.ok).toBe(false);

    const ok = transitionCapStatus({
      cap: baseCap(),
      action: 'submit_validation',
      user: user('preparer'),
      orgConfig: defaults,
      note: 'Sufficient justification text',
      evidenceRefs: ['memo-22'],
      nowIso: '2026-09-30T12:00:00Z',
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.cap.status).toBe('Pending validation');
      expect(ok.cap.lastSubmittedByUserId).toBe('u-preparer');
      expect(ok.cap.statusHistory?.length).toBe(1);
    }
  });

  it('four-eyes: submitter cannot verify own CAP', () => {
    const r = transitionCapStatus({
      cap: baseCap({ status: 'Pending validation', lastSubmittedByUserId: 'u-reviewer' }),
      action: 'verify_close',
      user: user('reviewer'),
      orgConfig: defaults,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Four-eyes/i);
  });

  it('reviewer verifies close and appends history', () => {
    const r = transitionCapStatus({
      cap: baseCap({ status: 'Pending validation', lastSubmittedByUserId: 'u-preparer' }),
      action: 'verify_close',
      user: user('reviewer'),
      orgConfig: defaults,
      note: 'Looks good',
      nowIso: '2026-09-30T12:00:00Z',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cap.status).toBe('Closed');
      expect(r.cap.retestStatus).toBe('Passed');
      expect(r.cap.statusHistory?.[0].fromStatus).toBe('Pending validation');
      expect(r.cap.statusHistory?.[0].toStatus).toBe('Closed');
    }
  });

  it('reject requires reason; closed blocks further changes', () => {
    const bad = transitionCapStatus({
      cap: baseCap({ status: 'Pending validation', lastSubmittedByUserId: 'u-preparer' }),
      action: 'reject',
      user: user('reviewer'),
      orgConfig: defaults,
      note: 'no',
    });
    expect(bad.ok).toBe(false);

    const closed = transitionCapStatus({
      cap: baseCap({ status: 'Closed' }),
      action: 'mark_in_progress',
      user: user('cia'),
      orgConfig: defaults,
    });
    expect(closed.ok).toBe(false);
  });

  it('fail_retest requires manager capability and note', () => {
    const prep = transitionCapStatus({
      cap: baseCap({ status: 'In progress' }),
      action: 'fail_retest',
      user: user('preparer'),
      orgConfig: defaults,
      note: 'Long enough fail note here',
    });
    expect(prep.ok).toBe(false);

    const mgr = transitionCapStatus({
      cap: baseCap({ status: 'In progress' }),
      action: 'fail_retest',
      user: user('audit_manager'),
      orgConfig: defaults,
      note: 'Long enough fail note here',
      nowIso: '2026-09-30T12:00:00Z',
    });
    expect(mgr.ok).toBe(true);
    if (mgr.ok) expect(mgr.cap.status).toBe('Overdue');
  });
});
