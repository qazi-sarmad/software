import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listTenants = vi.fn();
const createTenant = vi.fn();
const provisioningStatus = vi.fn();
const configurePlatformEmailSender = vi.fn();
const seedOrgRoles = vi.fn();
const setInviteCap = vi.fn();
const setTenantStatus = vi.fn();
const listFeatureCatalogue = vi.fn();
const setEntitlement = vi.fn();

vi.mock('../../data/platform', () => ({
  listTenants: () => listTenants(),
  createTenant: (...a: unknown[]) => createTenant(...a),
  provisioningStatus: (...a: unknown[]) => provisioningStatus(...a),
  configurePlatformEmailSender: (...a: unknown[]) => configurePlatformEmailSender(...a),
  seedOrgRoles: (...a: unknown[]) => seedOrgRoles(...a),
  setInviteCap: (...a: unknown[]) => setInviteCap(...a),
  setTenantStatus: (...a: unknown[]) => setTenantStatus(...a),
}));
vi.mock('../../data/entitlements', () => ({
  listFeatureCatalogue: () => listFeatureCatalogue(),
  setEntitlement: (...a: unknown[]) => setEntitlement(...a),
}));

import { SuperAdminProvisioning } from './SuperAdminProvisioning';

const TENANTS = [{ id: 'org-new', name: 'New Client', status: 'active', featureFlags: {}, createdAt: '' }];
const CATALOGUE = [
  { key: 'board_pack', label: 'Board Pack', description: 'Packs', group: 'Assurance', priceClass: 'included', defaultOn: true, requires: [], status: 'live' },
];
const STATUS = {
  orgId: 'org-new', rolesSeeded: 7, rolesReady: true, status: 'active', active: true,
  entitlementsEnabled: 0, inviteCap: 20, invitesSent: 1, hasInitialInvite: true,
  platformSenderReady: false, engagementCount: 0, canCreateEngagement: true, ready: false,
};

describe('SA-16 guided client provisioning (WP3)', () => {
  beforeEach(() => {
    listTenants.mockResolvedValue(TENANTS);
    listFeatureCatalogue.mockResolvedValue(CATALOGUE);
    createTenant.mockResolvedValue({ ok: true, orgId: 'org-new' });
    provisioningStatus.mockResolvedValue(STATUS);
    configurePlatformEmailSender.mockResolvedValue({ ok: true });
    seedOrgRoles.mockResolvedValue({ ok: true });
    setInviteCap.mockResolvedValue({ ok: true });
    setTenantStatus.mockResolvedValue({ ok: true });
    setEntitlement.mockResolvedValue({ ok: true });
  });

  it('renders the guided steps', async () => {
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning')).toBeTruthy());
    expect(screen.getByTestId('sa-provisioning-create')).toBeTruthy();
    expect(screen.getByTestId('sa-provisioning-entitlements')).toBeTruthy();
    expect(screen.getByTestId('sa-provisioning-cap')).toBeTruthy();
    expect(screen.getByTestId('sa-provisioning-sender')).toBeTruthy();
    expect(screen.getByTestId('sa-provisioning-finish')).toBeTruthy();
  });

  it('creates a tenant and reports the new id', async () => {
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-create-submit')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-provisioning-org-name'), { target: { value: 'New Client' } });
    fireEvent.change(screen.getByTestId('sa-provisioning-admin-email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByTestId('sa-provisioning-create-reason'), { target: { value: 'onboarding' } });
    fireEvent.click(screen.getByTestId('sa-provisioning-create-submit'));
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-created')).toBeTruthy());
    expect(createTenant).toHaveBeenCalledWith('New Client', 'a@b.test', 'onboarding');
    expect(screen.getByTestId('sa-provisioning-created').textContent).toContain('org-new');
  });

  it('shows a refused creation inline and does not navigate away', async () => {
    createTenant.mockResolvedValue({ ok: false, error: 'a reason is required when creating a tenant' });
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-create-submit')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-provisioning-create-submit'));
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-create-error')).toBeTruthy());
    expect(screen.getByTestId('sa-provisioning-create-error').textContent).toContain('reason is required');
    expect(screen.queryByTestId('sa-provisioning-created')).toBeNull();
  });

  it('reads back the readiness report for the chosen tenant', async () => {
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-tenant-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-provisioning-tenant-select'), { target: { value: 'org-new' } });
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-readiness')).toBeTruthy());
    expect(screen.getByTestId('sa-provisioning-check-roles').textContent).toContain('7');
    expect(screen.getByTestId('sa-provisioning-check-engagement').textContent).toContain('yes');
    expect(screen.getByTestId('sa-provisioning-check-ready').textContent).toContain('not ready');
  });

  it('sets the invite cap through the platform RPC', async () => {
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-tenant-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-provisioning-tenant-select'), { target: { value: 'org-new' } });
    fireEvent.change(screen.getByTestId('sa-provisioning-cap-input'), { target: { value: '35' } });
    fireEvent.click(screen.getByTestId('sa-provisioning-cap-submit'));
    await waitFor(() => expect(setInviteCap).toHaveBeenCalledWith('org-new', 35));
  });

  it('repairs the role catalogue through the platform RPC', async () => {
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-tenant-select')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-provisioning-tenant-select'), { target: { value: 'org-new' } });
    fireEvent.click(screen.getByTestId('sa-provisioning-repair-roles'));
    await waitFor(() => expect(seedOrgRoles).toHaveBeenCalledWith('org-new'));
  });

  it('surfaces an error state with a retry when the load fails', async () => {
    listTenants.mockRejectedValue(new Error('offline'));
    render(<SuperAdminProvisioning />);
    await waitFor(() => expect(screen.getByTestId('sa-provisioning-error')).toBeTruthy());
    expect(screen.getByTestId('sa-provisioning-retry')).toBeTruthy();
  });
});
