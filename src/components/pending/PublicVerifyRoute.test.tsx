import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const verifyCertificate = vi.fn();
const verifyBoardPack = vi.fn();

vi.mock('../../data/certificate', () => ({
  verifyCertificate: (id: string) => verifyCertificate(id),
  verifyBoardPack: (id: string) => verifyBoardPack(id),
}));

import { PublicVerifyRoute } from './PublicVerifyRoute';

describe('WK-06 public verification page (F11)', () => {
  beforeEach(() => {
    verifyCertificate.mockResolvedValue({
      status: 'valid', issuedAt: '2026-10-19T00:00:00Z', certHash: 'ab'.repeat(32),
      sealedWorkpapers: 12, findingsCount: 3, organisation: null, engagementTitle: null,
    });
    verifyBoardPack.mockResolvedValue({
      status: 'valid', issuedAt: '2026-10-19T00:00:00Z', dataHash: 'cd'.repeat(32), organisation: null,
    });
  });

  it('shows a valid certificate with its counts and hash', async () => {
    render(<PublicVerifyRoute kind="verify" idFromUrl="c1" />);
    await waitFor(() => expect(screen.getByTestId('wk-verify-status')).toBeTruthy());
    expect(screen.getByTestId('wk-verify-status').textContent).toContain('Valid');
    expect(screen.getByTestId('wk-verify-workpapers').textContent).toContain('12');
    expect(screen.getByTestId('wk-verify-findings').textContent).toContain('3');
    expect(screen.getByTestId('wk-verify-hash').textContent).toContain('abab');
  });

  it('hides the organisation and title when the tenant keeps them private', async () => {
    render(<PublicVerifyRoute kind="verify" idFromUrl="c1" />);
    await waitFor(() => expect(screen.getByTestId('wk-verify-status')).toBeTruthy());
    expect(screen.queryByTestId('wk-verify-organisation')).toBeNull();
    expect(screen.queryByTestId('wk-verify-title')).toBeNull();
  });

  it('shows a revoked certificate as revoked', async () => {
    verifyCertificate.mockResolvedValue({
      status: 'revoked', issuedAt: '2026-10-19T00:00:00Z', certHash: 'ab'.repeat(32),
      sealedWorkpapers: 12, findingsCount: 3, organisation: null, engagementTitle: null,
    });
    render(<PublicVerifyRoute kind="verify" idFromUrl="c1" />);
    await waitFor(() => expect(screen.getByTestId('wk-verify-status')).toBeTruthy());
    expect(screen.getByTestId('wk-verify-status').textContent).toContain('Revoked');
  });

  it('shows a plain message when the reference is unknown', async () => {
    verifyCertificate.mockResolvedValue({
      status: 'not_found', issuedAt: null, certHash: null,
      sealedWorkpapers: null, findingsCount: null, organisation: null, engagementTitle: null,
    });
    render(<PublicVerifyRoute kind="verify" idFromUrl="missing" />);
    await waitFor(() => expect(screen.getByTestId('wk-verify-not-found')).toBeTruthy());
  });

  it('verifies a board pack through the other anon function', async () => {
    render(<PublicVerifyRoute kind="pack" idFromUrl="p1" />);
    await waitFor(() => expect(screen.getByTestId('wk-verify-status')).toBeTruthy());
    expect(verifyBoardPack).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('wk-verify-hash').textContent).toContain('cdcd');
  });
});
