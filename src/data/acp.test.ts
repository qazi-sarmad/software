import { describe, expect, it } from 'vitest';
import {
  addRecipient, listRecipients, looksLikeEmail, removeRecipient,
} from './platformSettings';
import { listFeatureCatalogue, listPlans, listTenantEntitlements, setEntitlement, isFeatureRefusal, FEATURE_REFUSAL } from './entitlements';
import { listSetupSteps, saveSetupStep, setupProgress } from './setup';
import { acknowledgeConsultation, decideProposal, endConsultation, formatRemaining, getActiveConsultation, proposeChange, requestConsultation, secondsLeft } from './consultation';
import { listTutorials, recordTutorialView, tutorialHealth } from './tutorials';

/** With no Supabase environment variables every S1 data module is inert. No request leaves the process. */
describe('S1 data modules (not configured)', () => {
  it('platform settings reads return empty and writes report not configured', async () => {
    expect(await listRecipients()).toEqual([]);
    expect(await addRecipient('ops@example.com')).toEqual({ ok: false, reason: 'The platform settings module is not configured.' });
    expect(await removeRecipient('id')).toEqual({ ok: false, reason: 'The platform settings module is not configured.' });
  });

  it('entitlements reads return empty and the write reports not configured', async () => {
    expect(await listFeatureCatalogue()).toEqual([]);
    expect(await listPlans()).toEqual([]);
    expect(await listTenantEntitlements('org')).toEqual([]);
    expect(await setEntitlement('org', 'board_pack', true, 'Assurance', 'sold')).toEqual({ ok: false, reason: 'The entitlements module is not configured.' });
  });

  it('setup reads return empty and the write reports not configured', async () => {
    expect(await listSetupSteps('org_admin')).toEqual([]);
    expect(await saveSetupStep('org_admin', 'profile', 'done')).toEqual({ ok: false, reason: 'The setup module is not configured.' });
  });

  it('consultation reads return null and writes report not configured', async () => {
    expect(await getActiveConsultation('org')).toBeNull();
    expect(await acknowledgeConsultation('s')).toEqual({ ok: false, reason: 'The consultation module is not configured.' });
    expect(await endConsultation('s')).toEqual({ ok: false, reason: 'The consultation module is not configured.' });
    expect(await decideProposal('p', true)).toEqual({ ok: false, reason: 'The consultation module is not configured.' });
    expect(await requestConsultation('org', 'config', 2)).toEqual({ ok: false, reason: 'The consultation module is not configured.' });
    expect(await proposeChange('s', 'x', {})).toEqual({ ok: false, reason: 'The consultation module is not configured.' });
  });

  it('tutorials reads return empty and the write reports not configured', async () => {
    expect(await listTutorials()).toEqual([]);
    expect(await recordTutorialView('oa.profile', true)).toEqual({ ok: false, reason: 'The tutorials module is not configured.' });
  });
});

describe('S1 pure helpers', () => {
  it('looksLikeEmail accepts a normal address and rejects a bare word', () => {
    expect(looksLikeEmail('ops@qscorp.example')).toBe(true);
    expect(looksLikeEmail('  a@b.co ')).toBe(true);
    expect(looksLikeEmail('not-an-address')).toBe(false);
    expect(looksLikeEmail('a@b')).toBe(false);
  });

  it('isFeatureRefusal recognises the server refusal', () => {
    expect(isFeatureRefusal(FEATURE_REFUSAL)).toBe(true);
    expect(isFeatureRefusal('This feature is not included in your plan.')).toBe(true);
    expect(isFeatureRefusal('some other error')).toBe(false);
  });

  it('setupProgress counts done and skipped steps only', () => {
    const steps = [
      { stepKey: 'a', status: 'done' as const, answerRef: {}, updatedAt: '' },
      { stepKey: 'b', status: 'skipped' as const, answerRef: {}, updatedAt: '' },
      { stepKey: 'c', status: 'in_progress' as const, answerRef: {}, updatedAt: '' },
    ];
    expect(setupProgress(steps, 4)).toBeCloseTo(0.5);
    expect(setupProgress(steps, 0)).toBe(0);
    expect(setupProgress([], 3)).toBe(0);
  });

  it('secondsLeft floors at zero and formatRemaining is human', () => {
    const now = new Date('2026-10-19T10:00:00Z');
    expect(secondsLeft('2026-10-19T12:00:00Z', now)).toBe(7200);
    expect(secondsLeft('2026-10-19T09:00:00Z', now)).toBe(0);
    expect(formatRemaining(7200)).toBe('2 h 0 m');
    expect(formatRemaining(120)).toBe('2 m');
    expect(formatRemaining(30)).toBe('30 s');
  });

  it('tutorialHealth separates missing, stale and ok', () => {
    const rows = [
      { key: 'a', audience: 'both' as const, title: '', steps: [], mediaPath: 'a.gif', uiHash: 'h1', generatedAt: null },
      { key: 'b', audience: 'both' as const, title: '', steps: [], mediaPath: 'b.gif', uiHash: 'old', generatedAt: null },
      { key: 'c', audience: 'both' as const, title: '', steps: [], mediaPath: null, uiHash: null, generatedAt: null },
    ];
    const health = tutorialHealth(rows, { a: 'h1', b: 'new' });
    expect(health.ok).toEqual(['a']);
    expect(health.stale).toEqual(['b']);
    expect(health.missing).toEqual(['c']);
  });
});
