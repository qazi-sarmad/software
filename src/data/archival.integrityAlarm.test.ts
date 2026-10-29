import { describe, expect, it } from 'vitest';
import {
  acknowledgeIntegrityAlert,
  ledgerContinuityCheck,
  listIntegrityAlerts,
} from './archival';

/**
 * With no Supabase environment variables the module is inert: no request leaves the process. The
 * alarm's read returns an empty list (the verified state), the write reports not-configured, and the
 * continuity check — which must distinguish "verified" from "could not ask" — throws rather than
 * returning null, because null means "the chain is intact".
 */
describe('integrity alarm data module (not configured)', () => {
  it('the read returns empty, which is the verified state', async () => {
    expect(await listIntegrityAlerts()).toEqual([]);
  });

  it('the acknowledgement reports not configured', async () => {
    const res = await acknowledgeIntegrityAlert('id');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toMatch(/not configured/i);
  });

  it('the continuity check throws rather than claiming the chain is intact', async () => {
    await expect(ledgerContinuityCheck()).rejects.toThrow(/not configured/i);
  });
});
