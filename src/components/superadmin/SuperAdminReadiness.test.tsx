import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const platformReadiness = vi.fn();
const listComplaints = vi.fn();
const listPlatformAdmins = vi.fn();
const runDiagnostic = vi.fn();
const createComplaint = vi.fn();
const listComplaintEvents = vi.fn();
const resolveComplaint = vi.fn();
const assignComplaint = vi.fn();
const commentComplaint = vi.fn();
const listTenantsFn = vi.fn();

vi.mock('../../data/readiness', () => ({
  platformReadiness: (...a: unknown[]) => platformReadiness(...a),
  listComplaints: (...a: unknown[]) => listComplaints(...a),
  listPlatformAdmins: () => listPlatformAdmins(),
  runDiagnostic: (...a: unknown[]) => runDiagnostic(...a),
  createComplaint: (...a: unknown[]) => createComplaint(...a),
  listComplaintEvents: (...a: unknown[]) => listComplaintEvents(...a),
  resolveComplaint: (...a: unknown[]) => resolveComplaint(...a),
  assignComplaint: (...a: unknown[]) => assignComplaint(...a),
  commentComplaint: (...a: unknown[]) => commentComplaint(...a),
}));
vi.mock('../../data/platform', () => ({ listTenants: () => listTenantsFn() }));

import { SuperAdminReadiness } from './SuperAdminReadiness';

const TENANTS = [
  { id: 'org-a', name: 'Tenant A', status: 'active', featureFlags: {}, createdAt: '' },
];

const REPORT = {
  orgId: 'org-a',
  scope: 'platform' as const,
  summary: { green: 1, amber: 1, red: 1 },
  signals: [
    { signalId: 'roles_seeded', label: 'Role catalogue seeded', layer: 'organisation' as const, severity: 'critical' as const, verdict: 'green' as const, reason: '7 of 7 roles seeded', remediation: 'Seed the roles.', fixTarget: 'sa-provisioning' },
    { signalId: 'edge_functions', label: 'Edge Functions deployed', layer: 'environment' as const, severity: 'warning' as const, verdict: 'amber' as const, reason: 'not evaluated: the deployment list is not readable from the database', remediation: 'Deploy the Edge Functions.', fixTarget: 'runbook' },
    { signalId: 'platform_sender', label: 'Platform email sender', layer: 'platform' as const, severity: 'critical' as const, verdict: 'red' as const, reason: 'no default platform sender is enabled', remediation: 'Configure a default platform sender.', fixTarget: 'sa-email' },
  ],
};

const COMPLAINTS = [
  { id: 'c1', code: 'PRV-AAAAAA-0001', severity: 'critical' as const, sourceSignal: 'platform_sender', title: 'Sender missing', body: '', status: 'open' as const, assignedTo: null, createdAt: '', resolvedAt: null, resolutionReason: null },
];

describe('SA-20 readiness signals and complaints (D12/D13)', () => {
  beforeEach(() => {
    listTenantsFn.mockResolvedValue(TENANTS);
    listPlatformAdmins.mockResolvedValue([{ id: 'p1', email: 'platform@qscorp.test' }]);
    platformReadiness.mockResolvedValue(REPORT);
    listComplaints.mockResolvedValue(COMPLAINTS);
    runDiagnostic.mockResolvedValue({
      signalId: 'edge_functions', label: 'Edge Functions deployed', layer: 'environment',
      verdict: 'amber', reason: 'not evaluated: the deployment list is not readable from the database',
      evidence: 'not evaluated', remediation: 'Deploy the Edge Functions.', fixTarget: 'runbook', recorded: true,
    });
    createComplaint.mockResolvedValue({ ok: true, code: 'PRV-AAAAAA-0002', complaintId: 'c2' });
    listComplaintEvents.mockResolvedValue([{ kind: 'created', detail: {}, ts: '' }]);
    resolveComplaint.mockResolvedValue({ ok: true });
    assignComplaint.mockResolvedValue({ ok: true });
    commentComplaint.mockResolvedValue({ ok: true });
  });

  it('renders every signal with its verdict and reason, and never a green for an unevaluated check', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-signals')).toBeTruthy());

    expect(screen.getByTestId('sa-readiness-verdict-roles_seeded').textContent).toBe('Ready');
    expect(screen.getByTestId('sa-readiness-verdict-edge_functions').textContent).toBe('Not evaluated');
    expect(screen.getByTestId('sa-readiness-verdict-platform_sender').textContent).toBe('Broken');
    expect(screen.getByTestId('sa-readiness-reason-edge_functions').textContent).toContain('not evaluated');
    expect(screen.getByTestId('sa-readiness-summary').textContent).toContain('1 ready');
  });

  it('shows the three deployment layers with an honest per-layer verdict', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-layers')).toBeTruthy());

    expect(screen.getByTestId('sa-readiness-layer-verdict-environment').textContent).toBe('Not evaluated');
    expect(screen.getByTestId('sa-readiness-layer-verdict-platform').textContent).toBe('Broken');
    expect(screen.getByTestId('sa-readiness-layer-verdict-organisation').textContent).toBe('Ready');
    expect(screen.getByTestId('sa-readiness-runbook-note').textContent).toContain('Verify at the host');
  });

  it('offers Fix this for a signal whose fix is a screen, and Re-check + Contact for every non-green', async () => {
    const onNavigate = vi.fn();
    render(<SuperAdminReadiness onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-signals')).toBeTruthy());

    // A signal with a screen fix carries "Fix this"; one whose fix is the runbook does not.
    fireEvent.click(screen.getByTestId('sa-readiness-fix-platform_sender'));
    expect(onNavigate).toHaveBeenCalledWith('email');
    expect(screen.queryByTestId('sa-readiness-fix-edge_functions')).toBeNull();

    // A green signal carries neither.
    expect(screen.queryByTestId('sa-readiness-recheck-roles_seeded')).toBeNull();
    expect(screen.getByTestId('sa-readiness-recheck-edge_functions')).toBeTruthy();
    expect(screen.getByTestId('sa-readiness-contact-edge_functions')).toBeTruthy();
  });

  it('re-checks one signal in isolation and shows what it found', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-recheck-edge_functions')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sa-readiness-recheck-edge_functions'));
    await waitFor(() => expect(runDiagnostic).toHaveBeenCalledWith('org-a', 'edge_functions'));
    await waitFor(() => expect(screen.getByTestId('sa-readiness-diag-edge_functions').textContent).toContain('not evaluated'));
  });

  it('raises a coded complaint from a signal and reports the code', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-contact-platform_sender')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sa-readiness-contact-platform_sender'));
    await waitFor(() => expect(createComplaint).toHaveBeenCalled());
    const args = createComplaint.mock.calls[0];
    expect(args[0]).toBe('org-a');
    expect(args[2]).toEqual(['platform_sender']);
    await waitFor(() => expect(screen.getByTestId('sa-readiness-notice').textContent).toContain('PRV-AAAAAA-0002'));
  });

  it('surfaces a complaint refusal with its exact reason', async () => {
    createComplaint.mockResolvedValue({ ok: false, reason: 'a complaint title is required' });
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-contact-platform_sender')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sa-readiness-contact-platform_sender'));
    await waitFor(() => expect(screen.getByTestId('sa-readiness-action-error').textContent).toContain('title is required'));
  });

  it('lists the complaint register, filters it and opens the trail', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('complaint-PRV-AAAAAA-0001')).toBeTruthy());

    fireEvent.click(screen.getByTestId('complaint-trail-PRV-AAAAAA-0001'));
    await waitFor(() => expect(listComplaintEvents).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.getByTestId('complaint-events-PRV-AAAAAA-0001').textContent).toContain('created'));

    // A filter with no match shows the empty state.
    fireEvent.change(screen.getByTestId('complaints-filter'), { target: { value: 'resolved' } });
    await waitFor(() => expect(screen.getByTestId('complaints-empty')).toBeTruthy());
  });

  it('refuses to resolve without a reason (the form guard), then resolves with one', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('complaint-PRV-AAAAAA-0001')).toBeTruthy());

    fireEvent.click(screen.getByTestId('complaint-resolve-PRV-AAAAAA-0001'));
    await waitFor(() => expect(screen.getByTestId('sa-readiness-action-error').textContent).toContain('reason'));
    expect(resolveComplaint).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('complaint-resolve-reason-PRV-AAAAAA-0001'), { target: { value: 'fixed' } });
    fireEvent.click(screen.getByTestId('complaint-resolve-PRV-AAAAAA-0001'));
    await waitFor(() => expect(resolveComplaint).toHaveBeenCalledWith('c1', 'fixed'));
  });

  it('assigns a complaint to an administrator and refuses an empty assignee', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('complaint-PRV-AAAAAA-0001')).toBeTruthy());

    // An empty assignee is refused before anything is sent.
    fireEvent.click(screen.getByTestId('complaint-assign-save-PRV-AAAAAA-0001'));
    await waitFor(() => expect(screen.getByTestId('sa-readiness-action-error').textContent).toContain('administrator'));
    expect(assignComplaint).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('complaint-assign-PRV-AAAAAA-0001'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('complaint-assign-save-PRV-AAAAAA-0001'));
    await waitFor(() => expect(assignComplaint).toHaveBeenCalledWith('c1', 'p1', expect.any(String)));
  });

  it('adds a comment to a complaint and refuses an empty one', async () => {
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('complaint-PRV-AAAAAA-0001')).toBeTruthy());

    fireEvent.click(screen.getByTestId('complaint-comment-send-PRV-AAAAAA-0001'));
    await waitFor(() => expect(screen.getByTestId('sa-readiness-action-error').textContent).toContain('empty'));
    expect(commentComplaint).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('complaint-comment-PRV-AAAAAA-0001'), { target: { value: 'looking into it' } });
    fireEvent.click(screen.getByTestId('complaint-comment-send-PRV-AAAAAA-0001'));
    await waitFor(() => expect(commentComplaint).toHaveBeenCalledWith('c1', 'looking into it'));
  });

  it('shows an empty state when no signal is registered', async () => {
    platformReadiness.mockResolvedValue({ orgId: 'org-a', scope: 'platform', summary: { green: 0, amber: 0, red: 0 }, signals: [] });
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-readiness-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-readiness-empty')).toBeTruthy());
  });

  it('shows a retry when the load fails', async () => {
    listTenantsFn.mockRejectedValue(new Error('platform down'));
    render(<SuperAdminReadiness />);
    await waitFor(() => expect(screen.getByTestId('sa-readiness-error')).toBeTruthy());
    expect(screen.getByTestId('sa-readiness-retry')).toBeTruthy();
  });
});
