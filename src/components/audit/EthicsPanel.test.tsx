import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { EthicsPanel } from './EthicsPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

// D6: the acknowledgement write goes through the data module. Mock it so the panel's success and
// error paths can be exercised without a live database.
const acknowledgeEthics = vi.fn();
const ethicsStatus = vi.fn();
vi.mock('../../data/deployment', () => ({
  acknowledgeEthics: (...a: unknown[]) => acknowledgeEthics(...a),
  ethicsStatus: (...a: unknown[]) => ethicsStatus(...a),
}));

afterEach(() => {
  cleanup();
  acknowledgeEthics.mockReset();
  ethicsStatus.mockReset();
});

const renderAs = (role: Role, members: any[]) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <EthicsPanel members={members} />
      </AppProvider>
    </ThemeProvider>
  );

describe('EthicsPanel', () => {
  it('shows the empty state with no members', () => {
    renderAs('cia', []);
    expect(screen.getByTestId('ethics-empty')).toBeTruthy();
  });

  it('completes when every member acknowledged', () => {
    renderAs('cia', [
      { userId: 'u1', name: 'One', acknowledged: true },
      { userId: 'u2', name: 'Two', acknowledged: true },
    ]);
    expect(screen.getByTestId('ethics-ack-u1')).toBeTruthy();
    expect(screen.getByText('All members acknowledged')).toBeTruthy();
  });

  it('shows a self-only acknowledge button for the current user', () => {
    const me = testUser('preparer');
    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel members={[{ userId: me.id, name: me.name, acknowledged: false }]} />
        </AppProvider>
      </ThemeProvider>
    );
    expect(screen.getByTestId(`ethics-ack-button-${me.id}`)).toBeTruthy();
  });

  it('never lets a member acknowledge on behalf of another', () => {
    const me = testUser('preparer');
    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel members={[{ userId: 'someone-else', name: 'Other', acknowledged: false }]} />
        </AppProvider>
      </ThemeProvider>
    );
    expect(screen.getByTestId('ethics-pending-someone-else')).toBeTruthy();
    expect(screen.queryByTestId('ethics-ack-button-someone-else')).toBeNull();
  });

  it('writes the acknowledgement through the RPC and clears the row on success (D6)', async () => {
    const me = testUser('preparer');
    acknowledgeEthics.mockResolvedValue({ ok: true });
    ethicsStatus
      .mockResolvedValueOnce({ complete: false, members: [{ userId: me.id, acknowledged: false }] })
      .mockResolvedValueOnce({ complete: true, members: [{ userId: me.id, acknowledged: true }] });

    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel engagementId="e-1" />
        </AppProvider>
      </ThemeProvider>
    );

    const button = await screen.findByTestId(`ethics-ack-button-${me.id}`);
    button.click();

    await waitFor(() => expect(acknowledgeEthics).toHaveBeenCalledWith('e-1'));
    await waitFor(() => expect(screen.getByTestId(`ethics-ack-${me.id}`)).toBeTruthy());
    expect(screen.queryByTestId('ethics-error')).toBeNull();
  });

  it('shows the failure inline and keeps the row actionable (D6)', async () => {
    const me = testUser('preparer');
    acknowledgeEthics.mockResolvedValue({ ok: false, reason: 'not signed in' });
    ethicsStatus.mockResolvedValue({ complete: false, members: [{ userId: me.id, acknowledged: false }] });

    render(
      <ThemeProvider>
        <AppProvider user={me} seed={testSeed}>
          <EthicsPanel engagementId="e-1" />
        </AppProvider>
      </ThemeProvider>
    );

    const button = await screen.findByTestId(`ethics-ack-button-${me.id}`);
    button.click();

    await waitFor(() => expect(screen.getByTestId('ethics-error')).toBeTruthy());
    expect(screen.getByTestId('ethics-error').textContent).toContain('not signed in');
    expect(screen.getByTestId(`ethics-ack-button-${me.id}`)).toBeTruthy();
  });
});
