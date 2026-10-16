import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const whoami = vi.fn();
const listTenantsFn = vi.fn();
const listCapsFn = vi.fn();
const listGrantsFn = vi.fn();
const listTrailFn = vi.fn();

vi.mock('../../data/platform', () => ({
  platformWhoami: () => whoami(),
  listTenants: () => listTenantsFn(),
  listInviteCaps: () => listCapsFn(),
  listSupportGrants: () => listGrantsFn(),
  listTrail: () => listTrailFn(),
  setTenantStatus: () => Promise.resolve({ ok: true }),
  setFeatureFlag: () => Promise.resolve({ ok: true }),
  enableAi: () => Promise.resolve({ ok: true }),
  setInviteCap: () => Promise.resolve({ ok: true }),
  grantSupportAccess: () => Promise.resolve({ ok: true }),
  revokeSupportAccess: () => Promise.resolve({ ok: true }),
}));

import { SuperAdminPortal } from './SuperAdminPortal';

describe('Super Admin portal (C4, spec §24)', () => {
  it('shows the denial screen when the session is not a platform admin', async () => {
    whoami.mockResolvedValue({ userId: 'u', isPlatformAdmin: false });
    render(<SuperAdminPortal />);
    await waitFor(() => expect(screen.getByTestId('superadmin-denied')).toBeTruthy());
    expect(screen.queryByTestId('superadmin-portal')).toBeNull();
  });

  it('renders the tenants panel for a platform admin', async () => {
    whoami.mockResolvedValue({ userId: 'u', isPlatformAdmin: true });
    listTenantsFn.mockResolvedValue([
      { id: 'org-a', name: 'Tenant A', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' },
    ]);
    listCapsFn.mockResolvedValue([{ orgId: 'org-a', perUserDaily: 20 }]);
    render(<SuperAdminPortal />);
    await waitFor(() => expect(screen.getByTestId('superadmin-portal')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('tenant-org-a')).toBeTruthy());
    expect(screen.getByText('Tenant A')).toBeTruthy();
    expect(screen.getByTestId('superadmin-tabs')).toBeTruthy();
  });

  it('shows an empty state when there are no tenants', async () => {
    whoami.mockResolvedValue({ userId: 'u', isPlatformAdmin: true });
    listTenantsFn.mockResolvedValue([]);
    listCapsFn.mockResolvedValue([]);
    render(<SuperAdminPortal />);
    await waitFor(() => expect(screen.getByTestId('superadmin-tenants-empty')).toBeTruthy());
  });
});
