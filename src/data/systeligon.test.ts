import { describe, expect, it } from 'vitest';
import { loadSysteligonFindings } from './reportGraph';
import { recordSysteligonFindings } from './systeligon';
import type { RuleFinding } from '../lib/systeligon/types';

/**
 * With no Supabase environment variables the findings path is inert: recording reports that the
 * module is not configured, and the report reads no findings. No request leaves the process.
 */
describe('systeligon findings data module (not configured)', () => {
  it('recording a finding reports that the module is not configured', async () => {
    const finding = { ruleId: 'numeric.duplicates', ruleVersion: 1 } as unknown as RuleFinding;
    const result = await recordSysteligonFindings('e1', '2026-10-29T00:00:00Z', [finding]);
    expect(result.ok).toBe(false);
  });

  it('the report reads no findings', async () => {
    expect(await loadSysteligonFindings('e1')).toEqual([]);
  });
});
