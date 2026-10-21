import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const listGrantsFn = vi.fn();
const listJobsFn = vi.fn();

vi.mock('../../data/platform', () => ({
  listSupportGrants: () => listGrantsFn(),
  listJobHealth: () => listJobsFn(),
  grantSupportAccess: () => Promise.resolve({ ok: true }),
  revokeSupportAccess: () => Promise.resolve({ ok: true }),
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
