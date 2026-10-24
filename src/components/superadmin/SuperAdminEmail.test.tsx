import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listSenderProfiles = vi.fn();
const saveSenderProfile = vi.fn();
const setDefaultProfile = vi.fn();
const forceProfile = vi.fn();
const recordTestResult = vi.fn();

vi.mock('../../data/senderProfiles', async () => {
  const actual = await vi.importActual<typeof import('../../data/senderProfiles')>('../../data/senderProfiles');
  return {
    PROVIDER_LABELS: actual.PROVIDER_LABELS,
    credentialLine: actual.credentialLine,
    statusLabel: actual.statusLabel,
    listSenderProfiles: (o: string) => listSenderProfiles(o),
    saveSenderProfile: (...a: unknown[]) => saveSenderProfile(...a),
    setDefaultProfile: (id: string) => setDefaultProfile(id),
    forceProfile: (...a: unknown[]) => forceProfile(...a),
    recordTestResult: (...a: unknown[]) => recordTestResult(...a),
  };
});

import { SuperAdminEmail } from './SuperAdminEmail';

const profile = {
  id: 'p1', orgId: null, scope: 'platform' as const, provider: 'resend' as const,
  displayName: 'QSCorp', fromAddress: 'noreply@qscorp.example', replyTo: null,
  enabled: true, isDefault: true, forced: false, allowTenantProfile: true,
  fallbackToPlatform: true, dailyCap: null, status: 'ok' as const, lastTestAt: null,
  lastTestResult: null, credentialSecretId: 's1', credentialDisplay: '•••• 3456',
};

describe('SA-04 email sender profiles (F6, F5)', () => {
  beforeEach(() => {
    listSenderProfiles.mockResolvedValue([profile]);
    saveSenderProfile.mockResolvedValue({ ok: true });
    setDefaultProfile.mockResolvedValue({ ok: true });
    forceProfile.mockResolvedValue({ ok: true });
    recordTestResult.mockResolvedValue({ ok: true });
  });

  it('never renders a credential value, only the masked display', async () => {
    render(<SuperAdminEmail />);
    await waitFor(() => expect(screen.getByTestId('sender-p1')).toBeTruthy());
    const text = screen.getByTestId('sender-p1').textContent ?? '';
    expect(text).toContain('•••• 3456');
    expect(text).toContain('Working');
    expect(text).not.toMatch(/re_|sk_|password/i);
  });

  it('shows an empty state when no platform sender is set', async () => {
    listSenderProfiles.mockResolvedValue([]);
    render(<SuperAdminEmail />);
    await waitFor(() => expect(screen.getByTestId('superadmin-email-empty')).toBeTruthy());
  });

  it('saves a platform sender', async () => {
    render(<SuperAdminEmail />);
    await waitFor(() => expect(screen.getByTestId('superadmin-email-from')).toBeTruthy());
    fireEvent.change(screen.getByTestId('superadmin-email-from'), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByTestId('superadmin-email-save'));
    await waitFor(() => expect(saveSenderProfile).toHaveBeenCalled());
    expect((saveSenderProfile.mock.calls[0] as unknown[])[0]).toBeNull();
  });

  it('offers a Test button per sender', async () => {
    render(<SuperAdminEmail />);
    await waitFor(() => expect(screen.getByTestId('sender-test-p1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sender-test-p1'));
    await waitFor(() => expect(recordTestResult).toHaveBeenCalledWith('p1', expect.any(String), 'ok'));
  });

  it('shows the load error with a retry', async () => {
    listSenderProfiles.mockRejectedValue(new Error('network down'));
    render(<SuperAdminEmail />);
    await waitFor(() => expect(screen.getByTestId('superadmin-email-error').textContent).toContain('network down'));
  });
});
