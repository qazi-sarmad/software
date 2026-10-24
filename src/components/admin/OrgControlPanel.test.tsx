import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listFeatureCatalogue = vi.fn();
const listTenantEntitlements = vi.fn();
const requestConsultation = vi.fn();
const getActiveConsultation = vi.fn();
const acknowledgeConsultation = vi.fn();
const listConfigHistory = vi.fn();

vi.mock('../../data/entitlements', () => ({
  listFeatureCatalogue: () => listFeatureCatalogue(),
  listTenantEntitlements: (org: string) => listTenantEntitlements(org),
}));
vi.mock('../../data/configHistory', () => ({
  listConfigHistory: (limit: number) => listConfigHistory(limit),
}));
vi.mock('../../data/setup', () => ({
  listSetupSteps: () => Promise.resolve([]),
  saveSetupStep: () => Promise.resolve({ ok: true }),
  setupProgress: () => 0,
}));
vi.mock('../../data/tutorials', () => ({
  listTutorials: () => Promise.resolve([]),
  recordTutorialView: () => Promise.resolve({ ok: true }),
}));
vi.mock('../../data/consultation', () => ({
  getActiveConsultation: () => getActiveConsultation(),
  endConsultation: () => Promise.resolve({ ok: true }),
  acknowledgeConsultation: (id: string) => acknowledgeConsultation(id),
  requestConsultation: (org: string, kind: string, hours: number) => requestConsultation(org, kind, hours),
  secondsLeft: () => 0,
  formatRemaining: () => '0 s',
}));

const userRef = { current: { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current }),
}));

import { OrgControlPanel } from './OrgControlPanel';

describe('Org Admin control panel (OA-04, OA-01, OA-16)', () => {
  beforeEach(() => {
    userRef.current = { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never;
    listFeatureCatalogue.mockResolvedValue([
      { key: 'board_pack', label: 'Board Pack', description: 'Packs', group: 'Assurance', priceClass: 'included', defaultOn: true, requires: [], status: 'live' },
      { key: 'patterns', label: 'Patterns', description: 'Patterns', group: 'Insights', priceClass: 'add_on', defaultOn: false, requires: [], status: 'live' },
    ]);
    listTenantEntitlements.mockResolvedValue([{ featureKey: 'board_pack', enabled: true, planName: 'Standard', reason: 'seed' }]);
    requestConsultation.mockResolvedValue({ ok: true, sessionId: 'sess-1' });
    getActiveConsultation.mockResolvedValue(null);
    acknowledgeConsultation.mockResolvedValue({ ok: true });
    listConfigHistory.mockResolvedValue([]);
  });

  it('refuses a session without edit_config', () => {
    userRef.current = { id: 'u2', role: 'preparer', rights: {}, orgId: 'org-a' } as never;
    render(<OrgControlPanel />);
    expect(screen.getByTestId('org-control-denied')).toBeTruthy();
  });

  it('shows the effective feature set read-only', async () => {
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-features-list')).toBeTruthy());
    expect(screen.getByTestId('org-feature-board_pack').textContent).toContain('included');
    expect(screen.getByTestId('org-feature-patterns').textContent).toContain('Ask QSCorp to add this');
  });

  it('opens the setup wizard tab', async () => {
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-setup')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-setup'));
    await waitFor(() => expect(screen.getByTestId('org_admin-wizard')).toBeTruthy());
  });

  it('opens the Dual Session tab with the banner area', async () => {
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-consultation')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-consultation'));
    await waitFor(() => expect(screen.getByTestId('org-consultation')).toBeTruthy());
  });

  it('invites QSCorp to a tier-2 session', async () => {
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-consultation')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-consultation'));
    await waitFor(() => expect(screen.getByTestId('org-consultation-invite')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-consultation-invite'));
    await waitFor(() => expect(requestConsultation).toHaveBeenCalledWith('org-a', 'full_admin', 4));
  });

  it('acknowledges a request the platform side started', async () => {
    getActiveConsultation.mockResolvedValue({
      id: 'sess-9', orgId: 'org-a', kind: 'config', status: 'requested',
      initiatedBySide: 'platform', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-consultation')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-consultation'));
    await waitFor(() => expect(screen.getByTestId('org-consultation-acknowledge')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-consultation-acknowledge'));
    await waitFor(() => expect(acknowledgeConsultation).toHaveBeenCalledWith('sess-9'));
  });

  it('shows the load error', async () => {
    listFeatureCatalogue.mockRejectedValue(new Error('offline'));
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-features-error').textContent).toContain('offline'));
  });

  it('opens the configuration history tab and labels a consultant change', async () => {
    listConfigHistory.mockResolvedValue([
      { area: 'roles', areaLabel: 'Roles and rights', entity: 'role', entityId: 'r1', action: 'update', summary: 'CIA rights changed', actor: 'p1', actorIsPlatform: true, prevHash: null, rowHash: 'h1', createdAt: '2026-10-19T10:00:00Z' },
      { area: 'org_settings', areaLabel: 'Settings', entity: 'sampling.default', entityId: null, action: 'update', summary: 'sampling.default v1', actor: 'u1', actorIsPlatform: false, prevHash: null, rowHash: 'h2', createdAt: '2026-10-19T09:00:00Z' },
    ]);
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-history')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-history'));
    await waitFor(() => expect(screen.getByTestId('org-history-table')).toBeTruthy());
    expect(screen.getByTestId('org-history-platform-0').textContent).toContain('Platform consultant');
    expect(screen.getByTestId('org-history-row-1').textContent).toContain('Your organisation');
  });

  it('shows the empty configuration history', async () => {
    render(<OrgControlPanel />);
    await waitFor(() => expect(screen.getByTestId('org-control-tab-history')).toBeTruthy());
    fireEvent.click(screen.getByTestId('org-control-tab-history'));
    await waitFor(() => expect(screen.getByTestId('org-history-empty')).toBeTruthy());
  });
});
