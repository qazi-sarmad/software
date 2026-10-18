import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';
import { ThemeProvider } from './ThemeContext';
import { WorkbenchHeader } from '../components/audit/WorkbenchHeader';
import { ObservationDrilldown } from '../components/issues/ObservationDrilldown';
import { ReviewTab } from '../components/audit/file/ReviewTab';
import { InlineError } from '../components/common/InlineError';
import { initialEngagements, initialWorkpapers } from '../data/initialData';
import { testSeed, testUser } from '../test/testUsers';
import type { Role } from '../types';

const wrapperFor = (role: Role) => ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AppProvider user={testUser(role)} seed={testSeed}>{children}</AppProvider>
  </ThemeProvider>
);

const boot = async (role: Role) => {
  const h = renderHook(() => useApp(), { wrapper: wrapperFor(role) });
  await waitFor(() => expect(h.result.current.ledger.length).toBeGreaterThan(0));
  return h;
};

const OPEN_WP = 'wp-treas-1';
const SEALED_WP = 'wp-treas-2'; // sealed, prepared by usr-prep-1
const spies = () => ({
  alert: vi.spyOn(window, 'alert').mockImplementation(() => undefined),
  prompt: vi.spyOn(window, 'prompt').mockImplementation(() => null),
  confirm: vi.spyOn(window, 'confirm').mockImplementation(() => false),
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('commands report failures as results, never as native dialogs', () => {
  it('a forbidden workpaper sign-off returns FORBIDDEN and opens no dialog', async () => {
    const s = spies();
    const h = await boot('observer');
    let r: any;
    await act(async () => { r = await h.result.current.signOffWorkpaper(OPEN_WP); });
    expect(r).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.reason).toBeTruthy();
    expect(s.alert).not.toHaveBeenCalled();
  });

  it('reopen without a 10+ character justification returns FORBIDDEN with a reason', async () => {
    const s = spies();
    const h = await boot('cia');
    const before = h.result.current.ledger.length;
    let r: any;
    await act(async () => { r = await h.result.current.reopenWorkpaper(SEALED_WP, 'short'); });
    expect(r.ok).toBe(false);
    expect(h.result.current.ledger.length).toBe(before);
    expect(h.result.current.rawWorkpapers.find((w) => w.id === SEALED_WP)?.sealed).toBe(true);
    expect(s.alert).not.toHaveBeenCalled();
  });

  it('a blocked engagement sign-off returns the blockers as a result', async () => {
    const s = spies();
    const h = await boot('cia');
    const eng = initialEngagements.find((e) => initialWorkpapers.some((w) => w.engagementId === e.id && !w.sealed))!;
    let r: any;
    await act(async () => { r = await h.result.current.signOffEngagement(eng.id); });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(s.alert).not.toHaveBeenCalled();
  });

  it('an unknown engagement returns NOT_AVAILABLE', async () => {
    const h = await boot('cia');
    let r: any;
    await act(async () => { r = await h.result.current.signOffEngagement('does-not-exist'); });
    expect(r).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
  });
});

describe('sealing is refused when secure hashing is unavailable', () => {
  it('registerPopulation refuses, changes nothing and records an explicit error', async () => {
    const h = await boot('cia');
    const ledgerBefore = h.result.current.ledger.length;
    vi.stubGlobal('crypto', undefined);
    let r: any;
    await act(async () => {
      r = await h.result.current.registerPopulation(OPEN_WP, {
        sha256: 'a'.repeat(64), fileName: 'pop.csv', rowCount: 10, totalCents: 1000,
      });
    });
    expect(r).toMatchObject({ ok: false, code: 'HASH_UNAVAILABLE' });
    expect(r.reason).toMatch(/crypto\.subtle/);
    expect(h.result.current.ledger.length).toBe(ledgerBefore);
    expect(h.result.current.rawWorkpapers.find((w) => w.id === OPEN_WP)?.populationSha256).toBeFalsy();
    expect(h.result.current.ledgerError).toMatch(/crypto\.subtle/);
  });

  it('a workpaper sign-off refuses to seal and leaves the paper unsealed', async () => {
    const h = await boot('reviewer');
    // Control: the same command succeeds when hashing is available.
    const prepared = initialWorkpapers.find((w) => !w.sealed && w.preparerId !== testUser('reviewer').id)!;
    vi.stubGlobal('crypto', undefined);
    let r: any;
    await act(async () => { r = await h.result.current.signOffWorkpaper(prepared.id); });
    expect(r).toMatchObject({ ok: false, code: 'HASH_UNAVAILABLE' });
    expect(h.result.current.rawWorkpapers.find((w) => w.id === prepared.id)?.sealed).toBeFalsy();
  });

  it('control: the same sign-off succeeds when hashing is available', async () => {
    const h = await boot('reviewer');
    const prepared = initialWorkpapers.find((w) => !w.sealed && w.preparerId !== testUser('reviewer').id)!;
    let r: any;
    await act(async () => { r = await h.result.current.signOffWorkpaper(prepared.id); });
    expect(r).toEqual({ ok: true });
    expect(h.result.current.rawWorkpapers.find((w) => w.id === prepared.id)?.sealed).toBe(true);
    expect(h.result.current.ledgerError).toBeNull();
  });

  it('addEntity refuses and adds no entity', async () => {
    const h = await boot('cia');
    const before = h.result.current.rawEntities.length;
    vi.stubGlobal('crypto', undefined);
    let r: any;
    await act(async () => {
      r = await h.result.current.addEntity({
        universeId: h.result.current.rawUniverses[0].id, name: 'New Unit', code: 'NEWU',
        department: 'Ops', headOfDepartment: 'Someone', inherentRisk: 'low',
      });
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/crypto\.subtle/);
    expect(h.result.current.rawEntities.length).toBe(before);
  });

  it('raising an observation records nothing when hashing is unavailable', async () => {
    const h = await boot('preparer');
    const obsBefore = h.result.current.rawObservations.length;
    const issuesBefore = h.result.current.rawIssues.length;
    const wp = initialWorkpapers.find((w) => !w.sealed)!;
    vi.stubGlobal('crypto', undefined);
    await act(async () => {
      await expect(
        h.result.current.addObservation({
          workpaperId: wp.id, controlId: wp.controlId, entityId: wp.entityId, universeId: wp.universeId,
          title: 't', condition: 'c', criteria: '', cause: '', consequence: '', recommendation: '',
          severity: 'low', status: 'open',
        } as any)
      ).rejects.toMatchObject({ code: 'HASH_UNAVAILABLE' });
    });
    expect(h.result.current.rawObservations.length).toBe(obsBefore);
    expect(h.result.current.rawIssues.length).toBe(issuesBefore);
  });
});

describe('components show errors in place', () => {
  it('InlineError renders nothing without a message and an alert role with one', () => {
    const { rerender } = render(<InlineError message={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<InlineError message={'Line one\nLine two'} />);
    expect(screen.getByRole('alert').textContent).toContain('Line one');
  });

  it('InlineError dismiss calls the handler', () => {
    const onDismiss = vi.fn();
    render(<InlineError message="x" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ReviewTab shows a failed sign-off message inline', () => {
    const eng = initialEngagements[0];
    render(
      <ReviewTab
        engagement={{ ...eng, status: 'in_progress' } as any}
        gate={{ sealed: 0, total: 1, unsealed: 1, allSealed: false } as any}
        signOff={{ enabled: true } as any}
        onSignOff={() => undefined}
        error="Cannot sign off yet: 1 open comment"
      />
    );
    expect(screen.getByTestId('signoff-error').textContent).toContain('Cannot sign off yet');
  });

  it('ObservationDrilldown: an empty form shows an inline error and no native dialog', async () => {
    const s = spies();
    render(
      <ThemeProvider>
        <AppProvider user={testUser('preparer')} seed={testSeed}>
          <ObservationDrilldown data={null} />
        </AppProvider>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByText('Record Observation'));
    expect((await screen.findByTestId('observation-form-error')).textContent).toBe('Please provide title and condition.');
    expect(s.alert).not.toHaveBeenCalled();
  });

  it('WorkbenchHeader: reopening uses an inline form, rejects a short note inline, and never calls prompt/alert', async () => {
    const s = spies();
    const wp = initialWorkpapers.find((w) => w.id === SEALED_WP)!;
    render(
      <ThemeProvider>
        <AppProvider user={testUser('cia')} seed={testSeed}>
          <WorkbenchHeader workpaper={wp} />
        </AppProvider>
      </ThemeProvider>
    );
    fireEvent.click(screen.getByText('Reopen Paper'));
    const box = screen.getByLabelText('Reopening justification');
    fireEvent.change(box, { target: { value: 'short' } });
    fireEvent.click(screen.getByText('Confirm Reopen'));
    expect((await screen.findByTestId('workbench-action-error')).textContent).toMatch(/at least 10 characters/);
    expect(s.prompt).not.toHaveBeenCalled();
    expect(s.alert).not.toHaveBeenCalled();
  });
});
