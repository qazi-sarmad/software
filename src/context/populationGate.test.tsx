import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';
import { ThemeProvider } from './ThemeContext';
import { initialUsers } from '../data/initialData';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AppProvider>{children}</AppProvider>
  </ThemeProvider>
);
const SUMMARY = { sha256: 'a'.repeat(64), fileName: 'pop.csv', rowCount: 10, totalCents: 1000 };
const OPEN = 'wp-treas-1'; // unsealed, no population in the seed
const SEALED = 'wp-treas-2';

const boot = async (role = 'cia') => {
  const h = renderHook(() => useApp(), { wrapper });
  await act(async () => { h.result.current.setCurrentUser(initialUsers.find((u) => u.role === role)!); });
  await waitFor(() => expect(h.result.current.ledger.length).toBeGreaterThan(0));
  return h;
};

describe('Law 3: population gate enforced in the commands', () => {
  it('finalizeTest is rejected without a verified population and changes nothing', async () => {
    const h = await boot();
    const before = h.result.current.ledger.length;
    let r: any;
    await act(async () => { r = await h.result.current.finalizeTest(OPEN); });
    expect(r).toMatchObject({ ok: false, code: 'POPULATION_NOT_VERIFIED' });
    expect(h.result.current.ledger.length).toBe(before);
  });

  it('test steps cannot be recorded before the population is verified', async () => {
    const h = await boot();
    const r = h.result.current.setTestStepCompleted(OPEN, 'any', true);
    expect(r).toMatchObject({ ok: false, code: 'POPULATION_NOT_VERIFIED' });
  });

  it('rejects a malformed population summary', async () => {
    const h = await boot();
    let r: any;
    await act(async () => { r = await h.result.current.registerPopulation(OPEN, { ...SUMMARY, sha256: 'xyz' }); });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_POPULATION' });
  });

  it('after verification, finalize needs every step complete, then succeeds', async () => {
    const h = await boot();
    await act(async () => { await h.result.current.registerPopulation(OPEN, SUMMARY); });
    await act(async () => { h.result.current.setTestStepCompleted(OPEN, 'step-1', false); });
    let r: any;
    await act(async () => { r = await h.result.current.finalizeTest(OPEN); });
    expect(r).toMatchObject({ ok: false, code: 'STEPS_INCOMPLETE' });
    await act(async () => { h.result.current.setTestStepCompleted(OPEN, 'step-1', true); });
    await act(async () => { r = await h.result.current.finalizeTest(OPEN); });
    expect(r.ok).toBe(true);
    expect(h.result.current.rawWorkpapers.find((w) => w.id === OPEN)?.status).toBe('completed');
    expect(h.result.current.ledger.some((e) => e.eventType === 'population_verified')).toBe(true);
  });

  it('sealed papers refuse a population and evidence', async () => {
    const h = await boot();
    let r: any;
    await act(async () => { r = await h.result.current.registerPopulation(SEALED, SUMMARY); });
    expect(r).toMatchObject({ ok: false, code: 'SEALED' });
  });

  it('historical (scrubbed) view is read-only', async () => {
    const h = await boot();
    await act(async () => { h.result.current.setLedgerAsOf(1); });
    let r: any;
    await act(async () => { r = await h.result.current.registerPopulation(OPEN, SUMMARY); });
    expect(r).toMatchObject({ ok: false, code: 'READ_ONLY_HISTORY' });
    await act(async () => { r = await h.result.current.finalizeTest(OPEN); });
    expect(r).toMatchObject({ ok: false, code: 'READ_ONLY_HISTORY' });
  });

  it('a role without the capability cannot register a population', async () => {
    const h = await boot('observer');
    let r: any;
    await act(async () => { r = await h.result.current.registerPopulation(OPEN, SUMMARY); });
    expect(r.ok).toBe(false);
  });
});
