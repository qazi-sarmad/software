import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ChangeControlPanel } from './ChangeControlPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const getSettings = vi.fn();
const saveSettings = vi.fn();
const listChangesFn = vi.fn();
const requestChangeFn = vi.fn();
const decideChangeFn = vi.fn();

vi.mock('../../data/changeControl', async (orig) => {
  const actual = await orig<typeof import('../../data/changeControl')>();
  return {
    ...actual,
    getChangeControlSettings: (...a: unknown[]) => getSettings(...a),
    saveChangeControlSettings: (...a: unknown[]) => saveSettings(...a),
    listChanges: (...a: unknown[]) => listChangesFn(...a),
    requestChange: (...a: unknown[]) => requestChangeFn(...a),
    decideChange: (...a: unknown[]) => decideChangeFn(...a),
  };
});

afterEach(() => {
  cleanup();
  [getSettings, saveSettings, listChangesFn, requestChangeFn, decideChangeFn].forEach((m) => m.mockReset());
});

const renderAs = (role: Role, node: React.ReactNode) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>{node}</AppProvider>
    </ThemeProvider>
  );

describe('ChangeControlPanel (C3.2-A)', () => {
  it('settings mode is denied without edit_config', () => {
    renderAs('preparer', <ChangeControlPanel mode="settings" />);
    expect(screen.getByTestId('oa-changes-denied')).toBeTruthy();
  });

  it('settings mode loads, edits and saves', async () => {
    getSettings.mockResolvedValue({ approverRight: 'approve_plan', routineClasses: ['workpaper_reassign'], slaHours: 48, escalateRight: 'view_all_scopes' });
    saveSettings.mockResolvedValue({ ok: true });
    renderAs('org_admin', <ChangeControlPanel mode="settings" />);
    await waitFor(() => expect(screen.getByTestId('oa-changes-sla-hours')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-changes-sla-hours'), { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('oa-changes-save'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    expect(saveSettings.mock.calls[0][1]).toMatchObject({ slaHours: 24 });
  });

  it('engagement mode raises a change and lists it', async () => {
    listChangesFn.mockResolvedValue([]);
    requestChangeFn.mockResolvedValue({ ok: true, id: 'c1' });
    renderAs('cia', <ChangeControlPanel mode="engagement" engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-changes-empty')).toBeTruthy());
    fireEvent.change(screen.getByTestId('wk-changes-title'), { target: { value: 'Move dates' } });
    fireEvent.click(screen.getByTestId('wk-changes-raise'));
    await waitFor(() => expect(requestChangeFn).toHaveBeenCalled());
    expect(requestChangeFn.mock.calls[0][0]).toBe('e1');
  });

  it('engagement mode shows a pending change with approve and reject', async () => {
    listChangesFn.mockResolvedValue([
      { id: 'c9', klass: 'material', changeClass: 'scope', title: 'Widen scope', status: 'pending', requestedBy: 'u1', requestedAt: '2026-01-01', decidedBy: null, decidedAt: null, rejectReason: null, ledgerSeq: null },
    ]);
    decideChangeFn.mockResolvedValue({ ok: true });
    renderAs('cia', <ChangeControlPanel mode="engagement" engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-changes-row-c9-status')).toBeTruthy());
    expect(screen.getByTestId('wk-changes-row-c9-status').textContent).toContain('pending');
    fireEvent.change(screen.getByTestId('wk-changes-row-c9-reason'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByTestId('wk-changes-row-c9-approve'));
    await waitFor(() => expect(decideChangeFn).toHaveBeenCalledWith('c9', true, 'ok'));
  });

  it('shows an inline error when the raise fails', async () => {
    listChangesFn.mockResolvedValue([]);
    requestChangeFn.mockResolvedValue({ ok: false, reason: 'not allowed: the caller cannot change this engagement' });
    renderAs('cia', <ChangeControlPanel mode="engagement" engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-changes-empty')).toBeTruthy());
    fireEvent.change(screen.getByTestId('wk-changes-title'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('wk-changes-raise'));
    await waitFor(() => expect(screen.getByTestId('wk-changes-result').textContent).toContain('not allowed'));
  });
});
