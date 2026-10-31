import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const orgReadiness = vi.fn();
const listOrgComplaints = vi.fn();
const runOrgDiagnostic = vi.fn();
const createOrgComplaint = vi.fn();
const resolveComplaint = vi.fn();

vi.mock('../../data/readiness', () => ({
  orgReadiness: () => orgReadiness(),
  listOrgComplaints: () => listOrgComplaints(),
  runOrgDiagnostic: (...a: unknown[]) => runOrgDiagnostic(...a),
  createOrgComplaint: (...a: unknown[]) => createOrgComplaint(...a),
  resolveComplaint: (...a: unknown[]) => resolveComplaint(...a),
}));

const userRef = { current: { role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { OrgReadinessPanel } from './OrgReadinessPanel';

const REPORT = {
  orgId: 'org-a',
  scope: 'organisation' as const,
  summary: { green: 1, amber: 0, red: 1 },
  signals: [
    { signalId: 'roles_seeded', label: 'Role catalogue seeded', layer: 'organisation' as const, severity: 'critical' as const, verdict: 'green' as const, reason: '7 of 7 roles seeded', remediation: 'Seed the roles.', fixTarget: 'sa-provisioning' },
    { signalId: 'classification', label: 'Client classification set', layer: 'organisation' as const, severity: 'critical' as const, verdict: 'red' as const, reason: 'no classification is set', remediation: 'Set the classification.', fixTarget: 'sa-domains' },
  ],
};

const COMPLAINTS = [
  { id: 'c1', code: 'PRV-AAAAAA-0001', severity: 'critical' as const, sourceSignal: 'classification', title: 'Classification missing', body: '', status: 'open' as const, assignedTo: null, createdAt: '', resolvedAt: null, resolutionReason: null },
];

describe('org readiness and complaints (D12)', () => {
  beforeEach(() => {
    userRef.current = { role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never;
    orgReadiness.mockResolvedValue(REPORT);
    listOrgComplaints.mockResolvedValue(COMPLAINTS);
    runOrgDiagnostic.mockResolvedValue({
      signalId: 'classification', label: 'Client classification set', layer: 'organisation',
      verdict: 'red', reason: 'no classification is set', evidence: 'no classification is set',
      remediation: 'Set the classification.', fixTarget: 'sa-domains', recorded: true,
    });
    createOrgComplaint.mockResolvedValue({ ok: true, code: 'PRV-AAAAAA-0002', complaintId: 'c2' });
    resolveComplaint.mockResolvedValue({ ok: true });
  });

  it('renders the organisation signals with their verdict and reason', async () => {
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness')).toBeTruthy());

    expect(screen.getByTestId('org-readiness-verdict-roles_seeded').textContent).toBe('Ready');
    expect(screen.getByTestId('org-readiness-verdict-classification').textContent).toBe('Broken');
    expect(screen.getByTestId('org-readiness-reason-classification').textContent).toContain('no classification');
    // The environment layer is never shown here (L2): only organisation signals cross.
    expect(screen.queryByTestId('org-readiness-signal-edge_functions')).toBeNull();
  });

  it('re-checks one signal in isolation and shows what it found', async () => {
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness')).toBeTruthy());

    fireEvent.click(screen.getByTestId('org-readiness-recheck-classification'));
    await waitFor(() => expect(runOrgDiagnostic).toHaveBeenCalledWith('classification'));
    await waitFor(() => expect(screen.getByTestId('org-readiness-diag-classification').textContent).toContain('Broken'));
  });

  it('raises a coded complaint from a signal and reports the code', async () => {
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness')).toBeTruthy());

    fireEvent.click(screen.getByTestId('org-readiness-contact-classification'));
    await waitFor(() => expect(createOrgComplaint).toHaveBeenCalled());
    expect(createOrgComplaint.mock.calls[0][1]).toEqual(['classification']);
    await waitFor(() => expect(screen.getByTestId('org-readiness-notice').textContent).toContain('PRV-AAAAAA-0002'));
  });

  it('surfaces a complaint refusal with its exact reason', async () => {
    createOrgComplaint.mockResolvedValue({ ok: false, reason: 'not allowed: the edit_config right is required' });
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness')).toBeTruthy());

    fireEvent.click(screen.getByTestId('org-readiness-contact-classification'));
    await waitFor(() => expect(screen.getByTestId('org-readiness-action-error').textContent).toContain('edit_config'));
  });

  it('refuses to resolve without a reason, then resolves with one', async () => {
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-complaint-PRV-AAAAAA-0001')).toBeTruthy());

    fireEvent.click(screen.getByTestId('org-complaint-resolve-PRV-AAAAAA-0001'));
    await waitFor(() => expect(screen.getByTestId('org-readiness-action-error').textContent).toContain('reason'));
    expect(resolveComplaint).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('org-complaint-resolve-reason-PRV-AAAAAA-0001'), { target: { value: 'set it' } });
    fireEvent.click(screen.getByTestId('org-complaint-resolve-PRV-AAAAAA-0001'));
    await waitFor(() => expect(resolveComplaint).toHaveBeenCalledWith('c1', 'set it'));
  });

  it('shows an empty state when the organisation has no complaint', async () => {
    listOrgComplaints.mockResolvedValue([]);
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-complaints-empty')).toBeTruthy());
  });

  it('shows a retry when the load fails', async () => {
    orgReadiness.mockRejectedValue(new Error('down'));
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness-error')).toBeTruthy());
    expect(screen.getByTestId('org-readiness-retry')).toBeTruthy();
  });

  it('gates the raise and resolve controls on edit_config, naming the missing right', async () => {
    userRef.current = { role: 'observer', rights: { read_only: true }, orgId: 'org-a' } as never;
    render(<OrgReadinessPanel />);
    await waitFor(() => expect(screen.getByTestId('org-readiness')).toBeTruthy());
    expect(screen.getByTestId('org-readiness-contact-readonly-classification').textContent).toContain('edit_config');
    expect(screen.getByTestId('org-complaint-resolve-readonly-PRV-AAAAAA-0001').textContent).toContain('edit_config');
    expect((screen.getByTestId('org-readiness-contact-classification') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('org-complaint-resolve-PRV-AAAAAA-0001') as HTMLButtonElement).disabled).toBe(true);
  });
});
