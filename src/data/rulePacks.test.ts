import { describe, expect, it } from 'vitest';
import { listRulePacks, saveSignedRulePack } from './rulePacks';
import { justBelowThreshold } from '../lib/systeligon';

/**
 * With no Supabase environment variables the rule-pack module is inert: the list returns empty and a
 * save reports that the module is not configured. No request leaves the process.
 */
describe('rule packs data module (not configured)', () => {
  it('the list returns empty', async () => {
    expect(await listRulePacks()).toEqual([]);
  });

  it('a save reports that the module is not configured', async () => {
    const pack = { name: 'audit-default', version: 1, target: 'population' as const, rules: [justBelowThreshold] };
    const result = await saveSignedRulePack({} as never, pack, 'key-1', '2026-10-29T00:00:00Z', new Uint8Array(32));
    expect(result.ok).toBe(false);
  });
});
