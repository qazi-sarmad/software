import { describe, expect, it } from 'vitest';
import {
  listRulePacks, listRulePackRefusals, saveSignedRulePackArtifact, releaseRulePack, registerSigningKey,
} from './rulePacks';
import { justBelowThreshold } from '../lib/systeligon';

/**
 * With no Supabase environment variables the rule-pack module is inert: the list returns empty and a
 * save reports that the module is not configured. No request leaves the process.
 */
describe('rule packs data module (not configured)', () => {
  it('the list returns empty', async () => {
    expect(await listRulePacks()).toEqual([]);
  });

  it('the refusal log returns empty', async () => {
    expect(await listRulePackRefusals()).toEqual([]);
  });

  it('a save of a signed artifact reports that the module is not configured', async () => {
    const signed = {
      pack: { name: 'audit-default', version: 1, target: 'population' as const, rules: [justBelowThreshold] },
      contentHash: 'a'.repeat(64), signatureHex: 'b'.repeat(128),
      subject: { kind: 'rule_pack' as const, subjectId: 'audit-default@1', rootHash: 'a'.repeat(64), signedAt: '2026-10-29T00:00:00Z', keyId: 'key-1' },
    };
    const result = await saveSignedRulePackArtifact(signed as never, 'key-1');
    expect(result.ok).toBe(false);
  });

  it('a release reports that the module is not configured', async () => {
    const result = await releaseRulePack('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
  });

  it('a key registration reports that the module is not configured', async () => {
    const result = await registerSigningKey('key-1', 'abcd');
    expect(result.ok).toBe(false);
  });
});
