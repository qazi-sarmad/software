import { describe, expect, it } from 'vitest';
import { listRules, saveRule, testRule, listEventCatalogue, listTemplates, saveTemplate } from './automation';
import {
  PROVIDER_LABELS, credentialLine, forceProfile, listSenderProfiles, recordTestResult,
  saveSenderProfile, setDefaultProfile, statusLabel, type SenderProfile,
} from './senderProfiles';

/** With no Supabase environment variables every S2 data module is inert. No request leaves the process. */
describe('S2 data modules (not configured)', () => {
  it('automation reads return empty and writes report not configured', async () => {
    expect(await listRules('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await listTemplates('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await testRule('id', {})).toBeNull();
    expect(await saveRule('o', 'k', 'n', 'config.changed', [], [], true))
      .toEqual({ ok: false, reason: 'The automation module is not configured.' });
    expect(await saveTemplate('o', 'config.changed', 's', []))
      .toEqual({ ok: false, reason: 'The automation module is not configured.' });
  });

  it('the event catalogue is still offered offline, from the bundled copy', async () => {
    const events = await listEventCatalogue();
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.eventKey)).toContain('config.changed');
  });

  it('sender profile reads return empty and writes report not configured', async () => {
    expect(await listSenderProfiles('a0000000-0000-0000-0000-000000000001')).toEqual([]);
    expect(await saveSenderProfile(null, 'platform', 'resend', 'Q', 'n@q.test', null, {}, true, null))
      .toEqual({ ok: false, reason: 'The email sender module is not configured.' });
    expect(await setDefaultProfile('id'))
      .toEqual({ ok: false, reason: 'The email sender module is not configured.' });
    expect(await forceProfile('o', 'p', true, true))
      .toEqual({ ok: false, reason: 'The email sender module is not configured.' });
    expect(await recordTestResult('id', 'ok', 'ok'))
      .toEqual({ ok: false, reason: 'The email sender module is not configured.' });
  });
});

describe('sender profile presentation (F5)', () => {
  const profile: SenderProfile = {
    id: 'p', orgId: 'o', scope: 'tenant', provider: 'resend', displayName: 'A', fromAddress: 'a@x',
    replyTo: null, enabled: true, isDefault: false, forced: false, allowTenantProfile: true,
    fallbackToPlatform: true, dailyCap: null, status: 'untested', lastTestAt: null,
    lastTestResult: null, credentialSecretId: null, credentialDisplay: null,
  };

  it('shows "Not set" when there is no credential', () => {
    expect(credentialLine(profile)).toBe('Not set');
  });

  it('shows the masked display when a credential is set, never a value', () => {
    expect(credentialLine({ ...profile, credentialSecretId: 's', credentialDisplay: '•••• 3456' }))
      .toBe('•••• 3456');
  });

  it('labels the status in plain words', () => {
    expect(statusLabel({ ...profile, status: 'ok' })).toBe('Working');
    expect(statusLabel({ ...profile, status: 'failing' })).toBe('Failing');
    expect(statusLabel(profile)).toBe('Not tested');
  });

  it('names every provider adapter', () => {
    expect(PROVIDER_LABELS.map((p) => p.value)).toEqual(
      ['stub', 'resend', 'graph_delegated', 'graph_app', 'smtp']
    );
  });
});
