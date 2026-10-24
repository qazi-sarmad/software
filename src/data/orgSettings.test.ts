import { describe, expect, it } from 'vitest';
import {
  deleteSeverityLevel, getEmailSettings, listSeverityLevels, setEmailProvider,
  upsertSeverityLevel,
} from './orgSettings';
import { deleteSamplingRule, listSamplingRules, upsertSamplingRule } from './sampling';

/**
 * With no Supabase environment variables the org settings module is inert: reads return empty and
 * writes report that the module is not configured. No request leaves the process.
 */
describe('org settings data module (not configured)', () => {
  const notConfigured = { ok: false, reason: 'The settings module is not configured.' };
  const samplingNotConfigured = { ok: false, reason: 'The data module is not configured.' };

  it('reads return empty', async () => {
    expect(await listSamplingRules('org')).toEqual([]);
    expect(await listSeverityLevels()).toEqual([]);
    expect(await getEmailSettings()).toBeNull();
  });

  it('writes report that the module is not configured', async () => {
    const rule = { controlType: 'any', frequency: 'any', popBand: 'small', method: 'random' as const, baseSize: 5, pct: 0.1 };
    expect(await upsertSamplingRule(rule)).toEqual(samplingNotConfigured);
    expect(await deleteSamplingRule('id')).toEqual(samplingNotConfigured);
    expect(await upsertSeverityLevel('High', '--accent-cinnabar', 1)).toEqual(notConfigured);
    expect(await deleteSeverityLevel('id')).toEqual(notConfigured);
    expect(await setEmailProvider('resend', 'audit@example.com')).toEqual(notConfigured);
  });
});
