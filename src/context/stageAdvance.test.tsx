import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';
import { ThemeProvider } from './ThemeContext';
import { testSeed, testUser } from '../test/testUsers';
import type { Role } from '../types';

/**
 * Phase 2.1: the stage advance command. With no Supabase project configured the shell keeps the
 * in-memory demo behaviour, which is exactly what these tests exercise. The database path (the real
 * `set_engagement_stage` RPC) is proven by `supabase/tests/102_phase2_lifecycle.sql`.
 *
 * The point of these tests is the *wiring*: the command exists on the context, it refuses a caller
 * without manage_engagements, and it moves the engagement the UI renders.
 */
const wrapperFor = (role: Role) => ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AppProvider user={testUser(role)} seed={testSeed}>{children}</AppProvider>
  </ThemeProvider>
);

const boot = async (role: Role = 'cia') => {
  const h = renderHook(() => useApp(), { wrapper: wrapperFor(role) });
  await waitFor(() => expect(h.result.current.rawEngagements.length).toBeGreaterThan(0));
  return h;
};

describe('Phase 2.1: advanceEngagementStage is the one stage write path', () => {
  it('is exposed on the context', async () => {
    const h = await boot();
    expect(typeof h.result.current.advanceEngagementStage).toBe('function');
  });

  it('a caller without manage_engagements is refused and the stage is unchanged', async () => {
    // The preparer holds perform_work, not manage_engagements.
    const h = await boot('preparer');
    const before = h.result.current.rawEngagements.find((e) => e.id === 'eng-treas-1')?.stage;
    let r: any;
    await act(async () => { r = await h.result.current.advanceEngagementStage('eng-treas-1', 'conclusion'); });
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const after = h.result.current.rawEngagements.find((e) => e.id === 'eng-treas-1')?.stage;
    expect(after).toBe(before);
  });

  it('a caller with manage_engagements moves the stage', async () => {
    const h = await boot('cia');
    await act(async () => { await h.result.current.advanceEngagementStage('eng-treas-1', 'conclusion'); });
    const after = h.result.current.rawEngagements.find((e) => e.id === 'eng-treas-1')?.stage;
    expect(after).toBe('conclusion');
  });

  it('an unknown engagement is refused, not thrown', async () => {
    const h = await boot('cia');
    let r: any;
    await act(async () => { r = await h.result.current.advanceEngagementStage('nope', 'testing'); });
    expect(r).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
  });
});
