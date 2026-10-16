/**
 * SIRA data module (3I). Not-configured behaviour plus the mapper used for the cycle list.
 */
import { describe, expect, it } from 'vitest';

describe('sira data module (not configured)', () => {
  it('reads return empty and writes report not configured', async () => {
    const m = await import('./sira');
    expect(await m.listCycles()).toEqual([]);
    expect(await m.listScores('c1')).toEqual([]);
    expect(await m.listEmergentRisks()).toEqual([]);
    expect(await m.siraModelSnapshot('org')).toBeNull();
    const nc = { ok: false, reason: 'The data module is not configured.' };
    expect(await m.createSiraCycle('u1', 2026)).toEqual(nc);
    expect(await m.publishSiraCycle('c1')).toEqual(nc);
    expect(await m.submitEmergentRisk('u1', 'R')).toEqual(nc);
    expect(await m.decideEmergentRisk('r1', 'accepted', 'a valid reason')).toEqual(nc);
    expect(await m.setSiraAggregation('weighted_sum')).toEqual(nc);
    expect(await m.upsertSiraFactor('f', 'F', 1, 0)).toEqual(nc);
    expect(await m.setSiraBand('Low', 0, 10, 0)).toEqual(nc);
  });
});
