import { describe, expect, it } from 'vitest';
import { executeErasure, listErasureRequests, requestErasure, setErasureLegalHold } from './erasure';

/**
 * With no Supabase environment variables the erasure module is inert: the register reads empty and
 * every write reports not configured. No request leaves the process. The pseudonymise-in-place and
 * legal-hold refusal behaviour is proved against the real database in supabase/tests/107_sso_erasure.sql.
 */
describe('erasure data module (not configured)', () => {
  const notConfigured = { ok: false, reason: 'The erasure module is not configured.' };

  it('reads an empty register', async () => {
    expect(await listErasureRequests('org')).toEqual([]);
  });

  it('every write reports that the erasure module is not configured', async () => {
    expect(await requestErasure('org', 'subject@example.com', 'data-subject request')).toEqual(notConfigured);
    expect(await setErasureLegalHold('request', true, 'litigation hold')).toEqual(notConfigured);
    expect(await executeErasure('request', 'approved by counsel')).toEqual(notConfigured);
  });
});
