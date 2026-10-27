import { describe, expect, it } from 'vitest';
import { acknowledgePreflight, listPreflightAcknowledgements } from './preflight';

/** With no Supabase environment variables the module is inert. No request leaves the process. */
describe('pre-flight data module (not configured)', () => {
  it('reads return empty', async () => {
    expect(await listPreflightAcknowledgements('eng-1')).toEqual([]);
  });

  it('a write reports not configured', async () => {
    expect(await acknowledgePreflight('eng-1', 'missing_evidence', 'ev-1', 'waived by the manager'))
      .toEqual({ ok: false, reason: 'The pre-flight module is not configured.' });
  });
});
