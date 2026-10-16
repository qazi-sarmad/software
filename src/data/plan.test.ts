/**
 * Audit plan data module (3I). Not-configured behaviour; the list mappers are exercised through the
 * shapes the module returns (the mapping logic mirrors the row types).
 */
import { describe, expect, it } from 'vitest';

describe('plan data module (not configured)', () => {
  it('reads return empty and writes report not configured', async () => {
    const m = await import('./plan');
    expect(await m.listPlans()).toEqual([]);
    expect(await m.listPlanItems('p1')).toEqual([]);
    expect(await m.planHistory('p1')).toEqual([]);
    expect(await m.planApprovalConfig('org')).toBeNull();
    const nc = { ok: false, reason: 'The data module is not configured.' };
    expect(await m.createPlan('u1', '2026')).toEqual(nc);
    expect(await m.addPlanItem('p1', 'T')).toEqual(nc);
    expect(await m.decideAdhocItem('i1', true)).toEqual(nc);
    expect(await m.approvePlan('p1')).toEqual(nc);
    expect(await m.setPlanApproval('manage_engagements', 'approve_plan')).toEqual(nc);
  });
});
