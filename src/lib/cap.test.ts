import { describe, it, expect } from 'vitest';
import { changeCapDueDate, isValidIsoDate } from './cap';
import { AuditCapItem, Role } from '../types';

const baseCap: AuditCapItem = {
  id: 'CAP-T1',
  action: 'Fix it',
  title: 'Test CAP',
  owner: 'Owner Olivia',
  department: 'Procurement',
  severity: 'high',
  dueDate: '2026-10-15',
  status: 'Open',
  retestStatus: 'Not tested',
  identifiedDate: '2026-08-01',
  entityId: 'e1',
  engagementId: 'eng1',
};
const actorOf = (role: Role) => ({ id: `u-${role}`, name: `User ${role}`, role });

describe('changeCapDueDate', () => {
  const denied: Role[] = ['preparer', 'reviewer', 'observer', 'org_admin', 'auditee'];
  it.each(denied)('denies role %s', (role) => {
    const r = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf(role) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('forbidden');
  });

  it.each(['audit_manager', 'cia'] as Role[])('allows %s and updates due date', (role) => {
    const r = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf(role) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cap.dueDate).toBe('2026-11-01');
      expect(baseCap.dueDate).toBe('2026-10-15'); // input not mutated
    }
  });

  it('appends immutable history (who, when, old -> new)', () => {
    const r1 = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf('cia'), reason: ' client delay ' });
    if (!r1.ok) throw new Error('expected ok');
    const h1 = r1.cap.dueDateHistory!;
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({
      id: 'CAP-T1-DD-1', capId: 'CAP-T1', changedById: 'u-cia', changedByName: 'User cia',
      changedByRole: 'cia', oldDueDate: '2026-10-15', newDueDate: '2026-11-01', reason: 'client delay',
    });
    expect(Object.isFrozen(h1[0])).toBe(true);

    const r2 = changeCapDueDate({ cap: r1.cap, newDueDate: '2026-12-01', actor: actorOf('audit_manager') });
    if (!r2.ok) throw new Error('expected ok');
    expect(r2.cap.dueDateHistory).toHaveLength(2);
    expect(r2.cap.dueDateHistory![0]).toBe(h1[0]); // earlier entry untouched
    expect(r2.cap.dueDateHistory![1]).toMatchObject({ oldDueDate: '2026-11-01', newDueDate: '2026-12-01' });
    expect(h1).toHaveLength(1); // prior array not mutated
  });

  it('builds the notification shape', () => {
    const r = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf('cia') });
    if (!r.ok) throw new Error('expected ok');
    expect(r.notification).toEqual({
      id: 'NTF-CAP-T1-DD-1',
      type: 'cap_due_date_changed',
      capId: 'CAP-T1',
      recipients: ['Owner Olivia'],
      message: 'User cia changed the due date of CAP-T1 from 2026-10-15 to 2026-11-01 on 2026-09-30.',
      createdAt: r.historyEntry.changedAt,
      createdOnOrgLocal: '2026-09-30',
      read: false,
    });
  });

  it('uses the ORG-LOCAL date in messages (Karachi), not UTC', () => {
    // 2026-10-01 22:30 UTC = 2026-10-02 03:30 in Asia/Karachi
    const now = new Date('2026-10-01T22:30:00Z');
    const r = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf('cia'), now });
    if (!r.ok) throw new Error('expected ok');
    expect(r.notification.message).toContain('on 2026-10-02.');
    expect(r.historyEntry.changedOnOrgLocal).toBe('2026-10-02');
    expect(r.historyEntry.changedAt).toBe('2026-10-01T22:30:00.000Z');
    const utcZone = changeCapDueDate({ cap: baseCap, newDueDate: '2026-11-01', actor: actorOf('cia'), now, timeZone: 'UTC' });
    if (!utcZone.ok) throw new Error('expected ok');
    expect(utcZone.notification.message).toContain('on 2026-10-01.');
  });

  it('rejects invalid, unchanged and closed', () => {
    const a = actorOf('cia');
    for (const bad of ['', '2026-13-01', '2026-02-30', '01/11/2026']) {
      const r = changeCapDueDate({ cap: baseCap, newDueDate: bad, actor: a });
      expect(r.ok === false && r.error).toBe('invalid_date');
    }
    const same = changeCapDueDate({ cap: baseCap, newDueDate: '2026-10-15', actor: a });
    expect(same.ok === false && same.error).toBe('unchanged');
    const closed = changeCapDueDate({ cap: { ...baseCap, status: 'Closed' }, newDueDate: '2026-11-01', actor: a });
    expect(closed.ok === false && closed.error).toBe('cap_closed');
  });

  it('isValidIsoDate', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
  });
});
