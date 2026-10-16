/**
 * Deployment gate data module (3I). Not-configured behaviour plus the gate-outcome shape.
 */
import { describe, expect, it } from 'vitest';

describe('deployment data module (not configured)', () => {
  it('reads return empty/null and writes report not configured', async () => {
    const m = await import('./deployment');
    expect(await m.deployEngagement('u1', null)).toBeNull();
    expect(await m.ethicsStatus('e1')).toBeNull();
    expect(await m.listDeploymentRequests()).toEqual([]);
    const nc = { ok: false, reason: 'The data module is not configured.' };
    expect(await m.acknowledgeEthics('e1')).toEqual(nc);
    expect(await m.requestCombinedDeployment('u1', 'e1')).toEqual(nc);
    expect(await m.decideCombinedDeployment('r1', true)).toEqual(nc);
    expect(await m.escalateOverdueDeploymentRequests()).toEqual(nc);
  });
});
