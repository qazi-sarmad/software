import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getActiveConsultation = vi.fn();
const endConsultation = vi.fn();
const requestConsultation = vi.fn();
const acknowledgeConsultation = vi.fn();
const listTenantsFn = vi.fn();

vi.mock('../../data/consultation', () => ({
  getActiveConsultation: (org: string) => getActiveConsultation(org),
  endConsultation: (...a: unknown[]) => endConsultation(...a),
  requestConsultation: (...a: unknown[]) => requestConsultation(...a),
  acknowledgeConsultation: (...a: unknown[]) => acknowledgeConsultation(...a),
  secondsLeft: (expiresAt: string) => Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  formatRemaining: (s: number) => `${s} s`,
}));
vi.mock('../../data/platform', () => ({
  listTenants: () => listTenantsFn(),
}));

import { ConsultationBanner } from './ConsultationBanner';
import { SuperAdminConsultation } from '../superadmin/SuperAdminConsultation';

const SESSION = {
  id: 'sess-1', orgId: 'org-a', kind: 'config' as const, status: 'active' as const,
  initiatedBySide: 'platform' as const, expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe('GL-01 consultation banner (F4)', () => {
  beforeEach(() => {
    getActiveConsultation.mockResolvedValue(SESSION);
    endConsultation.mockResolvedValue({ ok: true });
  });

  it('shows who, tier, time left and End while a session is active', async () => {
    render(<ConsultationBanner orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('consultation-banner')).toBeTruthy());
    expect(screen.getByTestId('consultation-banner').textContent).toContain('QSCorp consultant');
    expect(screen.getByTestId('consultation-banner').textContent).toContain('tier 1');
    expect(screen.getByTestId('consultation-banner-time')).toBeTruthy();
    expect(screen.getByTestId('consultation-banner-end')).toBeTruthy();
  });

  it('is a plain strip, never a dialog', async () => {
    render(<ConsultationBanner orgId="org-a" />);
    const banner = await screen.findByTestId('consultation-banner');
    expect(banner.getAttribute('role')).toBeNull();
    expect(banner.querySelector('[aria-modal]')).toBeNull();
  });

  it('ends the session', async () => {
    render(<ConsultationBanner orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('consultation-banner-end')).toBeTruthy());
    fireEvent.click(screen.getByTestId('consultation-banner-end'));
    await waitFor(() => expect(endConsultation).toHaveBeenCalledWith('sess-1'));
  });

  it('renders nothing when there is no session', async () => {
    getActiveConsultation.mockResolvedValue(null);
    render(<ConsultationBanner orgId="org-a" />);
    await waitFor(() => expect(getActiveConsultation).toHaveBeenCalled());
    expect(screen.queryByTestId('consultation-banner')).toBeNull();
  });
});

describe('SA-09 Dual Session console (F4)', () => {
  beforeEach(() => {
    listTenantsFn.mockResolvedValue([{ id: 'org-a', name: 'Tenant A', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' }]);
    getActiveConsultation.mockResolvedValue(null);
    requestConsultation.mockResolvedValue({ ok: true, sessionId: 'sess-1' });
  });

  it('lists tenants and offers a request', async () => {
    render(<SuperAdminConsultation />);
    await waitFor(() => expect(screen.getByTestId('superadmin-consultation')).toBeTruthy());
    expect(screen.getByTestId('superadmin-consultation-org-a')).toBeTruthy();
    expect(screen.getByTestId('superadmin-consultation-request')).toBeTruthy();
  });

  it('requests a session for the chosen tenant', async () => {
    render(<SuperAdminConsultation />);
    await waitFor(() => expect(screen.getByTestId('superadmin-consultation-request')).toBeTruthy());
    fireEvent.click(screen.getByTestId('superadmin-consultation-request'));
    await waitFor(() => expect(requestConsultation).toHaveBeenCalledWith('org-a', 'config', 2));
  });

  it('shows an empty state when there are no tenants', async () => {
    listTenantsFn.mockResolvedValue([]);
    render(<SuperAdminConsultation />);
    await waitFor(() => expect(screen.getByTestId('superadmin-consultation-empty')).toBeTruthy());
  });
});
