import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const statusFn = vi.fn();
const versionsFn = vi.fn();
const setFn = vi.fn();

vi.mock('../../data/orgSecurity', () => ({
  getOrgSecurityStatus: () => statusFn(),
  listOrgSecurityVersions: () => versionsFn(),
  setRequireMfa: (required: boolean, reason: string) => setFn(required, reason),
}));

const rights = { edit_config: true } as Record<string, boolean>;
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { id: 'u', orgId: 'o', role: 'org_admin', rights } }),
}));

import { MfaPanel } from './MfaPanel';

describe('tenant multi-factor panel (0103)', () => {
  it('shows the current policy and history', async () => {
    statusFn.mockResolvedValue({ requireMfa: true, aal: 'aal2', mfaSatisfied: true });
    versionsFn.mockResolvedValue([
      { requireMfa: true, reason: 'client policy', createdAt: '2026-01-01T00:00:00Z', prevHash: null, rowHash: 'abcdef0123456789' },
    ]);
    render(<MfaPanel />);
    await waitFor(() => expect(screen.getByTestId('mfa-panel')).toBeTruthy());
    expect(screen.getByText(/Required for every member/)).toBeTruthy();
    expect(screen.getByTestId('mfa-required')).toBeTruthy();
    expect(screen.getByText(/client policy/)).toBeTruthy();
  });

  it('reports an empty history', async () => {
    statusFn.mockResolvedValue({ requireMfa: false, aal: 'aal1', mfaSatisfied: true });
    versionsFn.mockResolvedValue([]);
    render(<MfaPanel />);
    await waitFor(() => expect(screen.getByTestId('mfa-history-empty')).toBeTruthy());
  });
});
