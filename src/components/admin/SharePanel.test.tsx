import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listJointShares = vi.fn();
const listJointSharesWithMe = vi.fn();
const grantJointShare = vi.fn();
const revokeJointShare = vi.fn();
const listAssociatedOrgs = vi.fn();
const listConfigDistributions = vi.fn();
const distributeConfig = vi.fn();
const adoptConfig = vi.fn();
const listShareableEngagements = vi.fn();

vi.mock('../../data/shares', () => ({
  listJointShares: (...a: unknown[]) => listJointShares(...a),
  listJointSharesWithMe: (...a: unknown[]) => listJointSharesWithMe(...a),
  grantJointShare: (...a: unknown[]) => grantJointShare(...a),
  revokeJointShare: (...a: unknown[]) => revokeJointShare(...a),
  listAssociatedOrgs: (...a: unknown[]) => listAssociatedOrgs(...a),
  listConfigDistributions: (...a: unknown[]) => listConfigDistributions(...a),
  distributeConfig: (...a: unknown[]) => distributeConfig(...a),
  adoptConfig: (...a: unknown[]) => adoptConfig(...a),
  listShareableEngagements: (...a: unknown[]) => listShareableEngagements(...a),
}));

import { SharePanel } from './SharePanel';

beforeEach(() => {
  vi.clearAllMocks();
  listJointShares.mockResolvedValue([]);
  listJointSharesWithMe.mockResolvedValue([]);
  listAssociatedOrgs.mockResolvedValue([{ id: 'org-b', name: 'Beta Ltd' }]);
  listConfigDistributions.mockResolvedValue([]);
  listShareableEngagements.mockResolvedValue([{ id: 'eng-1', title: 'Payroll audit' }]);
});

describe('SharePanel', () => {
  it('shows the designed empty states when nothing is shared', async () => {
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-panel')).toBeTruthy());
    expect(screen.getByTestId('share-granted-empty')).toBeTruthy();
    expect(screen.getByTestId('share-with-me-empty')).toBeTruthy();
    expect(screen.getByTestId('share-config-empty')).toBeTruthy();
  });

  it('grants a joint-audit share to an associated counterparty and reloads', async () => {
    grantJointShare.mockResolvedValue({ ok: true, id: 'share-1' });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-grant-engagement')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-grant-engagement'), { target: { value: 'eng-1' } });
    fireEvent.change(screen.getByTestId('share-grant-counterparty'), { target: { value: 'org-b' } });
    fireEvent.click(screen.getByTestId('share-grant-submit'));
    await waitFor(() => expect(grantJointShare).toHaveBeenCalledWith('eng-1', 'org-b', null));
    await waitFor(() => expect(listJointShares).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('share-panel-result')).toBeTruthy();
  });

  it('renders the database refusal inline, never a blocking modal', async () => {
    grantJointShare.mockResolvedValue({ ok: false, reason: 'not allowed: the two organisations are not associated (group companies)' });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-grant-engagement')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-grant-engagement'), { target: { value: 'eng-1' } });
    fireEvent.change(screen.getByTestId('share-grant-counterparty'), { target: { value: 'org-b' } });
    fireEvent.click(screen.getByTestId('share-grant-submit'));
    await waitFor(() => expect(screen.getByTestId('share-panel-result').textContent).toMatch(/not associated/));
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it('explains when there is no associated group company yet', async () => {
    listAssociatedOrgs.mockResolvedValue([]);
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-no-counterparties')).toBeTruthy());
    expect(screen.queryByTestId('share-grant-submit')).toBeNull();
  });

  it('revokes a live share with a reason', async () => {
    listJointShares.mockResolvedValue([{
      id: 'share-1', engagementId: 'eng-1', engagementTitle: 'Payroll audit', ownerOrgId: 'org-a',
      counterpartyOrgId: 'org-b', counterpartyName: 'Beta Ltd', rights: 'edit',
      grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, revokedAt: null, revokeReason: null, live: true,
    }]);
    revokeJointShare.mockResolvedValue({ ok: true });
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-revoke-share-1')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-revoke-reason-share-1'), { target: { value: 'audit concluded' } });
    fireEvent.click(screen.getByTestId('share-revoke-share-1'));
    await waitFor(() => expect(revokeJointShare).toHaveBeenCalledWith('share-1', 'audit concluded'));
  });

  it('lists the joint audits shared with this organisation', async () => {
    listJointSharesWithMe.mockResolvedValue([{
      id: 'share-x', engagementId: 'eng-9', engagementTitle: 'Group treasury review', ownerOrgId: 'org-a',
      ownerName: 'Alpha Ltd', rights: 'edit', grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, live: true,
    }]);
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-with-me-share-x').textContent).toMatch(/Group treasury review/));
  });

  it('distributes configuration to a member and adopts a distribution', async () => {
    distributeConfig.mockResolvedValue({ ok: true, id: 'd1' });
    adoptConfig.mockResolvedValue({ ok: true, keys: 2 });
    listConfigDistributions.mockResolvedValue([{
      id: 'd1', parentOrgId: 'org-a', parentName: 'Alpha Ltd', memberOrgId: 'org-b', memberName: 'Beta Ltd',
      keys: ['sampling'], distributedAt: '2026-10-25T00:00:00Z', revokedAt: null,
    }]);
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-config-member')).toBeTruthy());
    fireEvent.change(screen.getByTestId('share-config-member'), { target: { value: 'org-b' } });
    fireEvent.click(screen.getByTestId('share-config-distribute'));
    await waitFor(() => expect(distributeConfig).toHaveBeenCalledWith('org-b', null));
    await waitFor(() => expect(screen.getByTestId('share-config-adopt-d1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('share-config-adopt-d1'));
    await waitFor(() => expect(adoptConfig).toHaveBeenCalledWith('d1'));
  });

  it('surfaces a load failure with a retry, not a blank screen', async () => {
    listJointShares.mockRejectedValue(new Error('network down'));
    render(<SharePanel />);
    await waitFor(() => expect(screen.getByTestId('share-panel-error')).toBeTruthy());
    expect(screen.getByTestId('share-panel-retry')).toBeTruthy();
  });
});
