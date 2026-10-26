import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listShares = vi.fn();
const listSharesWithMe = vi.fn();
const grantShare = vi.fn();
const revokeShare = vi.fn();
const viewSharedUniverse = vi.fn();
const setHeadLevel = vi.fn();
const listMembers = vi.fn();
const listUniverses = vi.fn();

vi.mock('../../data/shares', () => ({
  listShares: (...a: unknown[]) => listShares(...a),
  listSharesWithMe: (...a: unknown[]) => listSharesWithMe(...a),
  grantShare: (...a: unknown[]) => grantShare(...a),
  revokeShare: (...a: unknown[]) => revokeShare(...a),
  viewSharedUniverse: (...a: unknown[]) => viewSharedUniverse(...a),
  setHeadLevel: (...a: unknown[]) => setHeadLevel(...a),
}));
vi.mock('../../data/admin', () => ({ listMembers: (...a: unknown[]) => listMembers(...a) }));
vi.mock('../../data/universe', () => ({ listUniverses: (...a: unknown[]) => listUniverses(...a) }));

import { SharePanel } from './SharePanel';

beforeEach(() => {
  vi.clearAllMocks();
  listShares.mockResolvedValue([]);
  listSharesWithMe.mockResolvedValue([]);
  listMembers.mockResolvedValue([{ userId: 'u1', displayName: 'Ayesha', roleSlug: 'cia', roleName: 'CIA', hierarchyLevel: null, managerId: null }]);
  listUniverses.mockResolvedValue([{ id: 'uni-1', name: 'Operations Audit', domain: 'Operations' }]);
});

describe('SharePanel', () => {
  it('shows the designed empty states when nothing is shared', async () => {
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-panel')).toBeTruthy());
    expect(screen.getByTestId('share-granted-empty')).toBeTruthy();
    expect(screen.getByTestId('share-with-me-empty')).toBeTruthy();
  });

  it('grants a share through the data module and reloads', async () => {
    grantShare.mockResolvedValue({ ok: true, id: 'share-1' });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-grant-universe')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-grant-universe'), { target: { value: 'uni-1' } });
    fireEvent.change(screen.getByTestId('share-grant-grantee'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByTestId('share-grant-submit'));
    await waitFor(() => expect(grantShare).toHaveBeenCalledWith('uni-1', 'u1', null));
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('share-panel-result')).toBeTruthy();
  });

  it('renders the database refusal inline, never a blocking modal', async () => {
    grantShare.mockResolvedValue({ ok: false, reason: 'not allowed: a share is granted by a Level-1 or Level-2 Head' });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-grant-universe')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-grant-universe'), { target: { value: 'uni-1' } });
    fireEvent.change(screen.getByTestId('share-grant-grantee'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByTestId('share-grant-submit'));
    await waitFor(() => expect(screen.getByTestId('share-panel-result').textContent).toMatch(/Level-1 or Level-2 Head/));
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('revokes a live share with a reason', async () => {
    listShares.mockResolvedValue([{
      id: 'share-1', universeId: 'uni-1', universeName: 'Operations Audit', granteeUserId: 'u1',
      grantedBy: 'me', grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, revokedAt: null, revokeReason: null,
    }]);
    revokeShare.mockResolvedValue({ ok: true });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-revoke-share-1')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-revoke-reason-share-1'), { target: { value: 'no longer needed' } });
    fireEvent.click(screen.getByTestId('share-revoke-share-1'));
    await waitFor(() => expect(revokeShare).toHaveBeenCalledWith('share-1', 'no longer needed'));
  });

  it('opens the read-only projection of a live share and blocks a dead one', async () => {
    listSharesWithMe.mockResolvedValue([
      { id: 'share-live', universeId: 'uni-1', universeName: 'Operations Audit', grantedBy: 'h', grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, live: true },
      { id: 'share-dead', universeId: 'uni-2', universeName: 'Payroll', grantedBy: 'h', grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, live: false },
    ]);
    viewSharedUniverse.mockResolvedValue({ universeId: 'uni-1', live: true, entities: [{ id: 'e1', name: 'Lahore Plant', status: 'approved' }], engagements: [] });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-view-share-live')).toBeTruthy());
    expect((screen.getByTestId('share-view-share-dead') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('share-view-share-live'));
    await waitFor(() => expect(screen.getByTestId('share-view-entities').textContent).toMatch(/Lahore Plant/));
  });

  it('surfaces a load failure with a retry, not a blank screen', async () => {
    listShares.mockRejectedValue(new Error('network down'));
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-panel-error')).toBeTruthy());
    expect(screen.getByTestId('share-panel-retry')).toBeTruthy();
  });
});
