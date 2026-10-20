import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listExternalAuditors = vi.fn();
const listExternalAccessLog = vi.fn();
const inviteExternalAuditor = vi.fn();
const saveExternalAuditorGrants = vi.fn();
const revokeExternalAuditor = vi.fn();

vi.mock('../../data/externalAuditors', () => ({
  listExternalAuditors: (o: string) => listExternalAuditors(o),
  listExternalAccessLog: (o: string, n: number) => listExternalAccessLog(o, n),
  inviteExternalAuditor: (o: unknown) => inviteExternalAuditor(o),
  saveExternalAuditorGrants: (...a: unknown[]) => saveExternalAuditorGrants(...a),
  revokeExternalAuditor: (...a: unknown[]) => revokeExternalAuditor(...a),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ rawEngagements: [{ id: 'eng-1', title: 'FY25 audit' }] }),
}));

import { ExternalAuditorsPanel } from './ExternalAuditorsPanel';

const grant = {
  userId: 'u-ext', email: 'auditor@example.test', active: true,
  engagementId: 'eng-1', title: 'FY25 audit',
  canViewSummary: true, canDownloadPack: false, canDownloadCertificate: false, canVerify: true,
  expiresAt: new Date(Date.now() + 5 * 864e5).toISOString(), revokedAt: null,
};

describe('OA-14 external auditors (F13)', () => {
  beforeEach(() => {
    listExternalAuditors.mockResolvedValue([grant]);
    listExternalAccessLog.mockResolvedValue([
      { id: 'l1', userId: 'u-ext', engagementId: 'eng-1', functionName: 'ext_list_engagements',
        outcome: 'ok', detail: {}, ts: new Date().toISOString() },
    ]);
    inviteExternalAuditor.mockResolvedValue({ ok: true });
    saveExternalAuditorGrants.mockResolvedValue({ ok: true });
    revokeExternalAuditor.mockResolvedValue({ ok: true });
  });

  it('renders the invite form, the matrix and the access log', async () => {
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors')).toBeTruthy());
    expect(screen.getByTestId('oa-auditors-email')).toBeTruthy();
    expect(screen.getByTestId('oa-auditors-matrix')).toBeTruthy();
    expect(screen.getByTestId('oa-auditors-log')).toBeTruthy();
    expect(screen.getByTestId('oa-auditors-row-u-ext')).toBeTruthy();
  });

  it('invites an external auditor with the selected engagements', async () => {
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors-email')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-auditors-email'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByTestId('oa-auditors-engagement-eng-1'));
    fireEvent.click(screen.getByTestId('oa-auditors-invite'));
    await waitFor(() => expect(inviteExternalAuditor).toHaveBeenCalled());
    expect(inviteExternalAuditor.mock.calls[0][0]).toMatchObject({
      email: 'new@example.test', engagementIds: ['eng-1'], expiryKind: 'time_boxed',
    });
    await waitFor(() => expect(screen.getByTestId('oa-auditors-result-ok')).toBeTruthy());
  });

  it('warns plainly when permanent access is chosen', async () => {
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors-expiry-kind')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-auditors-expiry-kind'), { target: { value: 'permanent' } });
    expect(screen.getByTestId('oa-auditors-permanent-warning')).toBeTruthy();
  });

  it('flips a permission cell through the grants RPC', async () => {
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors-cell-u-ext-download_pack')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-auditors-cell-u-ext-download_pack'));
    await waitFor(() => expect(saveExternalAuditorGrants).toHaveBeenCalled());
    const call = saveExternalAuditorGrants.mock.calls[0];
    expect(call[0]).toBe('org-a');
    expect(call[1][0]).toMatchObject({ userId: 'u-ext', engagementId: 'eng-1', canDownloadPack: true });
  });

  it('shows the server message when the feature is not included in the plan', async () => {
    inviteExternalAuditor.mockResolvedValue({ ok: false, reason: 'This feature is not included in your plan.' });
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors-email')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-auditors-email'), { target: { value: 'x@example.test' } });
    fireEvent.click(screen.getByTestId('oa-auditors-invite'));
    await waitFor(() => expect(screen.getByTestId('oa-auditors-result-error').textContent)
      .toContain('not included in your plan'));
  });

  it('renders the designed empty states', async () => {
    listExternalAuditors.mockResolvedValue([]);
    listExternalAccessLog.mockResolvedValue([]);
    render(<ExternalAuditorsPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('oa-auditors-matrix-empty')).toBeTruthy());
    expect(screen.getByTestId('oa-auditors-log-empty')).toBeTruthy();
  });
});
