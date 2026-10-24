import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listCertificates = vi.fn();
const getCertificateConfig = vi.fn();
const issueCertificate = vi.fn();
const revokeCertificate = vi.fn();
const saveCertificateConfig = vi.fn();
const getCertificate = vi.fn();
const getBranding = vi.fn();
const getOrgSettingsExtra = vi.fn();

vi.mock('../../data/certificate', () => ({
  listCertificates: (o: string) => listCertificates(o),
  getCertificateConfig: (o: string) => getCertificateConfig(o),
  issueCertificate: (e: string) => issueCertificate(e),
  revokeCertificate: (id: string, reason: string) => revokeCertificate(id, reason),
  saveCertificateConfig: (o: string, f: unknown) => saveCertificateConfig(o, f),
  getCertificate: (id: string) => getCertificate(id),
}));
vi.mock('../../data/branding', () => ({ getBranding: (o: string) => getBranding(o) }));
vi.mock('../../data/boardPack', () => ({ getOrgSettingsExtra: (o: string) => getOrgSettingsExtra(o) }));

const userRef = { current: { id: 'u1', role: 'cia', rights: { manage_engagements: true, can_reopen: true, edit_config: true }, orgId: 'org-a' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { CertificatePanel } from './CertificatePanel';

const FIELDS = [
  { fieldKey: 'engagement_id', label: 'Engagement identifier', ordinal: 1, enabled: true },
  { fieldKey: 'engagement_root_hash', label: 'Engagement root hash', ordinal: 4, enabled: true },
  { fieldKey: 'findings_count', label: 'Findings count', ordinal: 7, enabled: false },
];

describe('WK-05 engagement certificate panel (F11)', () => {
  beforeEach(() => {
    userRef.current = { id: 'u1', role: 'cia', rights: { manage_engagements: true, can_reopen: true, edit_config: true }, orgId: 'org-a' };
    listCertificates.mockResolvedValue([
      { id: 'c1', engagementId: 'e1', version: 1, certHash: 'ab'.repeat(32), status: 'valid',
        issuedBy: 'u1', issuedAt: '2026-10-19T00:00:00Z', revokedAt: null, revokeReason: null },
    ]);
    getCertificateConfig.mockResolvedValue(FIELDS);
    getBranding.mockResolvedValue({ pageSize: 'A4', marginsMm: 20, fonts: { heading: 'Inter', body: 'Inter' }, colours: {} });
    getOrgSettingsExtra.mockResolvedValue({ appBaseUrl: 'https://app.invalid' });
    issueCertificate.mockResolvedValue({ ok: true });
    revokeCertificate.mockResolvedValue({ ok: true });
    saveCertificateConfig.mockResolvedValue({ ok: true });
    getCertificate.mockResolvedValue({ row: {}, canonical: { engagement_title: 'Treasury review' } });
  });

  it('lists the certificates with a plain status label', async () => {
    render(<CertificatePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-certificate')).toBeTruthy());
    expect(screen.getByTestId('wk-certificate-c1')).toBeTruthy();
    expect(screen.getByTestId('wk-certificate-status-c1').textContent).toContain('Valid');
  });

  it('issues a certificate through the RPC', async () => {
    render(<CertificatePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-certificate-issue')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-certificate-issue'));
    await waitFor(() => expect(issueCertificate).toHaveBeenCalledWith('e1'));
  });

  it('requires a reason of at least five characters before revoking', async () => {
    render(<CertificatePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-certificate-revoke-c1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wk-certificate-revoke-c1'));
    const confirm = screen.getByTestId('wk-certificate-revoke-confirm-c1') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('wk-certificate-revoke-reason-c1'), { target: { value: 'Wrong engagement' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(revokeCertificate).toHaveBeenCalledWith('c1', 'Wrong engagement'));
  });

  it('a reader without manage_engagements sees a disabled issue button and a plain explanation', async () => {
    userRef.current = { id: 'u2', role: 'reviewer', rights: { manage_engagements: false, can_reopen: false, edit_config: false }, orgId: 'org-a' };
    render(<CertificatePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('wk-certificate')).toBeTruthy());
    expect((screen.getByTestId('wk-certificate-issue') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('wk-certificate-no-issue')).toBeTruthy();
  });

  it('toggles a certificate field through the config RPC', async () => {
    render(<CertificatePanel engagementId="e1" />);
    await waitFor(() => expect(screen.getByTestId('oa-certificate-enabled-findings_count')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-certificate-enabled-findings_count'));
    await waitFor(() => expect(saveCertificateConfig).toHaveBeenCalled());
    const [, sent] = saveCertificateConfig.mock.calls[0] as [string, { fieldKey: string; enabled: boolean }[]];
    expect(sent.find((f) => f.fieldKey === 'findings_count')?.enabled).toBe(true);
  });
});
