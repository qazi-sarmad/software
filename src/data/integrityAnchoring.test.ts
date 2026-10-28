import { describe, expect, it } from 'vitest';
import {
  listTimestampAuthorities, listTrustAnchors, saveTimestampAuthority, saveTrustAnchor, setAnchoringMin,
} from './integrityAnchoring';

/**
 * With no Supabase environment variables the integrity-anchoring module is inert: reads return empty
 * and writes report that the module is not configured. No request leaves the process.
 */
describe('integrity anchoring data module (not configured)', () => {
  const notConfigured = { ok: false, reason: 'The integrity module is not configured.' };

  it('reads return empty', async () => {
    expect(await listTimestampAuthorities()).toEqual([]);
    expect(await listTrustAnchors()).toEqual([]);
  });

  it('writes report that the module is not configured', async () => {
    expect(await saveTimestampAuthority(null, 'TSA', 'https://tsa.example', true, 10, ''))
      .toEqual(notConfigured);
    expect(await saveTrustAnchor(null, 'Anchor', 'A'.repeat(16), true)).toEqual(notConfigured);
    expect(await setAnchoringMin('00000000-0000-0000-0000-000000000000', 2))
      .toEqual(notConfigured);
  });
});
