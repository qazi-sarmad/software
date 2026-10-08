import { describe, it, expect } from 'vitest';
import { departmentsOf, auditsForDepartment, workpapersForAudit } from './findingTarget';

const ents: any[] = [
  { id: 'e1', department: 'Treasury' },
  { id: 'e2', department: 'Operations' },
  { id: 'e3', department: 'Treasury' },
];
const engs: any[] = [
  { id: 'g1', entityId: 'e1', title: 'Cash', status: 'in_progress' },
  { id: 'g2', entityId: 'e3', title: 'Liquidity', isAdHoc: true, status: 'in_progress' },
  { id: 'g3', entityId: 'e2', title: 'Branch', status: 'in_progress' },
];
const wps: any[] = [
  { id: 'w1', engagementId: 'g1', refCode: 'WP-1', title: 'A', status: 'in_progress' },
  { id: 'w2', engagementId: 'g1', refCode: 'WP-2', title: 'B', status: 'signed_off' },
  { id: 'w3', engagementId: 'g3', refCode: 'WP-3', title: 'C', status: 'in_progress' },
];

describe('finding target cascade', () => {
  it('lists unique sorted departments', () => {
    expect(departmentsOf(ents)).toEqual(['Operations', 'Treasury']);
  });
  it('lists audits in a department and labels special ones', () => {
    const a = auditsForDepartment('Treasury', ents, engs);
    expect(a.map((x) => x.id)).toEqual(['g1', 'g2']);
    expect(a[1].special).toBe(true);
    expect(a[1].label).toContain('Special');
    expect(a[0].label).toContain('Annual plan');
  });
  it('lists only that audit’s papers and flags locked ones', () => {
    const w = workpapersForAudit('g1', wps, engs);
    expect(w.map((x) => x.id)).toEqual(['w1', 'w2']);
    expect(w.find((x) => x.id === 'w2')!.locked).toBe(true);
    expect(w.find((x) => x.id === 'w1')!.locked).toBe(false);
  });
});
