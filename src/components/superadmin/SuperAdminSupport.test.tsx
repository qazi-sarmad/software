import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const listGrantsFn = vi.fn();
const listJobsFn = vi.fn();
const grantActiveFn = vi.fn();
const listEngagementsFn = vi.fn();
const readObjectFn = vi.fn();
const accessLogFn = vi.fn();
const grantFn = vi.fn();
const revokeFn = vi.fn();

vi.mock('../../data/platform', () => ({
  listSupportGrants: () => listGrantsFn(),
  listJobHealth: () => listJobsFn(),
  grantSupportAccess: (org: string, opts: unknown, hours: number) => grantFn(org, opts, hours),
  revokeSupportAccess: (id: string, reason: string) => revokeFn(id, reason),
  supportGrantActive: (org: string) => grantActiveFn(org),
  supportListEngagements: (org: string) => listEngagementsFn(org),
  supportReadObject: (k: string, id: string, org: string) => readObjectFn(k, id, org),
  supportAccessLog: (org: string) => accessLogFn(org),
}));

import { SuperAdminSupport } from './SuperAdminSupport';

describe('SA-02 platform health: scheduled jobs (C2.2)', () => {
  it('shows each job with its last run', async () => {
    listGrantsFn.mockResolvedValue([]);
    listJobsFn.mockResolvedValue([
      { jobId: 1, jobName: 'cap-notification-sweep', schedule: '0 6 * * *', active: true,
        command: 'select public.cap_notification_sweep()', lastStart: '2026-10-20T06:00:00Z',
        lastEnd: '2026-10-20T06:00:01Z', lastStatus: 'succeeded', lastMessage: null },
      { jobId: 2, jobName: 'grant-expiry-sweep', schedule: '20 * * * *', active: true,
        command: 'select public.grant_expiry_sweep()', lastStart: null,
        lastEnd: null, lastStatus: null, lastMessage: null },
    ]);

    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('superadmin-job-health-list')).toBeTruthy());
    expect(screen.getByTestId('job-cap-notification-sweep')).toBeTruthy();
    expect(screen.getByTestId('job-status-cap-notification-sweep').textContent).toContain('succeeded');
    expect(screen.getByTestId('job-status-grant-expiry-sweep').textContent).toContain('Has not run yet');
  });

  it('says so when no job is registered, rather than showing an error', async () => {
    listGrantsFn.mockResolvedValue([]);
    listJobsFn.mockResolvedValue([]);
    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('superadmin-job-health-empty')).toBeTruthy());
    expect(screen.queryByTestId('superadmin-job-health-error')).toBeNull();
  });

  it('shows the failure of the reader inline', async () => {
    listGrantsFn.mockResolvedValue([]);
    listJobsFn.mockRejectedValue(new Error('platform administrators only'));
    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('superadmin-job-health-error')).toBeTruthy());
  });
});

describe('SA-02 support session (C2.9)', () => {
  const renderReady = async () => {
    listGrantsFn.mockResolvedValue([]);
    listJobsFn.mockResolvedValue([]);
    accessLogFn.mockResolvedValue([]);
    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('superadmin-support-session')).toBeTruthy());
  };

  it('keeps the session closed when no live grant exists', async () => {
    grantActiveFn.mockResolvedValue(false);
    await renderReady();
    const org = screen.getByTestId('superadmin-support-session-org');
    fireEvent.change(org, { target: { value: 'a0000000-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByTestId('superadmin-support-session-open'));
    await waitFor(() => expect(screen.getByTestId('superadmin-support-session-error')).toBeTruthy());
    expect(screen.getByTestId('superadmin-support-session-error').textContent).toContain('stays closed');
    expect(screen.queryByTestId('superadmin-support-session-open-panel')).toBeNull();
  });

  it('lists the granted org engagements and reads one, showing the trail', async () => {
    await renderReady();
    grantActiveFn.mockResolvedValue(true);
    listEngagementsFn.mockResolvedValue([
      { engagementId: '50000000-0000-0000-0000-0000000000a1', title: 'A-Eng1', stage: 'testing',
        sealed: false, orgName: 'Org A' },
    ]);
    accessLogFn.mockResolvedValue([
      { id: 'l1', grantId: 'g1', actorId: 'f0', functionName: 'support_list_engagements',
        objectKind: null, objectId: null, outcome: 'ok', createdAt: '2026-10-21T06:00:00Z' },
    ]);
    readObjectFn.mockResolvedValue([
      { objectKind: 'engagement', objectId: '50000000-0000-0000-0000-0000000000a1', label: 'A-Eng1',
        detail: { stage: 'testing', sealed: false } },
    ]);

    fireEvent.change(screen.getByTestId('superadmin-support-session-org'),
      { target: { value: 'a0000000-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByTestId('superadmin-support-session-open'));
    await waitFor(() => expect(screen.getByTestId('superadmin-support-session-list')).toBeTruthy());
    expect(screen.getByTestId('support-engagement-50000000-0000-0000-0000-0000000000a1')).toBeTruthy();
    expect(screen.getByTestId('superadmin-support-session-trail')).toBeTruthy();

    fireEvent.click(screen.getByTestId('support-read-50000000-0000-0000-0000-0000000000a1'));
    await waitFor(() =>
      expect(screen.getByTestId('superadmin-support-session-read-result').textContent).toContain('A-Eng1'));
    expect(readObjectFn).toHaveBeenCalledWith('engagement', '50000000-0000-0000-0000-0000000000a1',
      'a0000000-0000-0000-0000-000000000001');
  });

  it('surfaces a database refusal of the session inline', async () => {
    grantActiveFn.mockRejectedValue(new Error('not allowed: platform administrator only'));
    await renderReady();
    fireEvent.change(screen.getByTestId('superadmin-support-session-org'),
      { target: { value: 'a0000000-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByTestId('superadmin-support-session-open'));
    await waitFor(() =>
      expect(screen.getByTestId('superadmin-support-session-error').textContent).toContain('platform administrator only'));
  });
});

describe('SA-02 support access grant / revoke (F85, R6)', () => {
  const renderReady = async () => {
    listJobsFn.mockResolvedValue([]);
    listGrantsFn.mockResolvedValue([]);
    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('superadmin-support-session')).toBeTruthy());
  };

  it('grants a time-boxed read grant and reloads the list', async () => {
    grantFn.mockResolvedValue({ ok: true });
    await renderReady();
    fireEvent.change(screen.getAllByPlaceholderText('00000000-0000-0000-0000-000000000000')[0],
      { target: { value: 'a0000000-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() =>
      expect(grantFn).toHaveBeenCalledWith('a0000000-0000-0000-0000-000000000001', {}, 4));
    // The reload happens only on a successful grant.
    await waitFor(() => expect(listGrantsFn).toHaveBeenCalledTimes(2));
  });

  it('surfaces a refused grant inline and does not reload', async () => {
    grantFn.mockResolvedValue({ ok: false, reason: 'not allowed: platform administrator only' });
    await renderReady();
    fireEvent.change(screen.getAllByPlaceholderText('00000000-0000-0000-0000-000000000000')[0],
      { target: { value: 'a0000000-0000-0000-0000-000000000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() =>
      expect(screen.getByTestId('superadmin-support-result').textContent).toContain('platform administrator only'));
    expect(listGrantsFn).toHaveBeenCalledTimes(1);
  });

  it('requires a reason of at least four characters before a revoke is offered', async () => {
    const grant = { id: 'g-1', orgId: 'a0000000-0000-0000-0000-000000000001', scope: 'content_read',
      grantedBy: 'p', grantedAt: '2026-10-30T00:00:00Z', expiresAt: '2099-10-30T00:00:00Z',
      revokedAt: null, revokeReason: null };
    listGrantsFn.mockResolvedValue([grant]);
    listJobsFn.mockResolvedValue([]);
    render(<SuperAdminSupport />);
    await waitFor(() => expect(screen.getByTestId('grant-g-1')).toBeTruthy());

    const reason = screen.getByPlaceholderText('Reason');
    fireEvent.change(reason, { target: { value: 'no' } });
    expect((screen.getByRole('button', { name: 'Revoke' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reason, { target: { value: 'tenant asked' } });
    expect((screen.getByRole('button', { name: 'Revoke' }) as HTMLButtonElement).disabled).toBe(false);

    revokeFn.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeFn).toHaveBeenCalledWith('g-1', 'tenant asked'));
  });
});
