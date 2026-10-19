import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listFeatureCatalogue = vi.fn();
const listTenantEntitlements = vi.fn();
const setEntitlement = vi.fn();
const listTenantsFn = vi.fn();

vi.mock('../../data/entitlements', () => ({
  listFeatureCatalogue: () => listFeatureCatalogue(),
  listTenantEntitlements: (org: string) => listTenantEntitlements(org),
  setEntitlement: (...args: unknown[]) => setEntitlement(...args),
}));
vi.mock('../../data/platform', () => ({
  listTenants: () => listTenantsFn(),
}));

import { SuperAdminFeatures } from './SuperAdminFeatures';

const CATALOGUE = [
  { key: 'board_pack', label: 'Board Pack', description: 'Packs', group: 'Assurance', priceClass: 'included', defaultOn: true, requires: [], status: 'live' },
  { key: 'patterns', label: 'Patterns', description: 'Patterns', group: 'Insights', priceClass: 'add_on', defaultOn: false, requires: [], status: 'live' },
];

describe('SA-14 features and plans (F25)', () => {
  beforeEach(() => {
    listFeatureCatalogue.mockResolvedValue(CATALOGUE);
    listTenantsFn.mockResolvedValue([{ id: 'org-a', name: 'Tenant A', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' }]);
    listTenantEntitlements.mockResolvedValue([
      { featureKey: 'board_pack', enabled: true, planName: 'Standard', reason: 'seed' },
      { featureKey: 'patterns', enabled: false, planName: 'Standard', reason: 'seed' },
    ]);
    setEntitlement.mockResolvedValue({ ok: true });
  });

  it('lists the catalogue and the per-tenant entitlements', async () => {
    render(<SuperAdminFeatures />);
    await waitFor(() => expect(screen.getByTestId('superadmin-features')).toBeTruthy());
    expect(screen.getByTestId('feature-catalogue-board_pack')).toBeTruthy();
    expect(screen.getByTestId('entitlement-board_pack')).toBeTruthy();
    expect(screen.getByTestId('entitlement-toggle-patterns').textContent).toContain('Turn on');
  });

  it('refuses a change without a reason', async () => {
    render(<SuperAdminFeatures />);
    await waitFor(() => expect(screen.getByTestId('entitlement-toggle-patterns')).toBeTruthy());
    fireEvent.click(screen.getByTestId('entitlement-toggle-patterns'));
    await waitFor(() => expect(screen.getByTestId('superadmin-features-result').textContent).toContain('reason is required'));
    expect(setEntitlement).not.toHaveBeenCalled();
  });

  it('sends the change with the reason once one is given', async () => {
    render(<SuperAdminFeatures />);
    await waitFor(() => expect(screen.getByTestId('entitlement-reason-patterns')).toBeTruthy());
    fireEvent.change(screen.getByTestId('entitlement-reason-patterns'), { target: { value: 'sold as add-on' } });
    fireEvent.click(screen.getByTestId('entitlement-toggle-patterns'));
    await waitFor(() => expect(setEntitlement).toHaveBeenCalledWith('org-a', 'patterns', true, null, 'sold as add-on'));
  });

  it('shows an empty state when there are no tenants', async () => {
    listTenantsFn.mockResolvedValue([]);
    render(<SuperAdminFeatures />);
    await waitFor(() => expect(screen.getByTestId('superadmin-features-empty')).toBeTruthy());
  });

  it('shows the load error with a retry', async () => {
    listFeatureCatalogue.mockRejectedValue(new Error('offline'));
    render(<SuperAdminFeatures />);
    await waitFor(() => expect(screen.getByTestId('superadmin-features-error').textContent).toContain('offline'));
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
