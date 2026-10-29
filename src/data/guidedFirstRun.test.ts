/**
 * Guided first-run data module (U6). Not-configured behaviour: with no Supabase environment the
 * state read is inert (null) and the create reports the shared not-configured reason, so a bare
 * checkout renders its guided state rather than an error.
 */
import { describe, expect, it } from 'vitest';

describe('guidedFirstRun data module (not configured)', () => {
  it('is inert: the state read is null and the create reports not configured', async () => {
    const m = await import('./guidedFirstRun');
    expect(await m.getOrgDataState()).toBeNull();
    expect(await m.createUniverse('Treasury')).toEqual({
      ok: false,
      reason: 'The data module is not configured.',
    });
  });
});
