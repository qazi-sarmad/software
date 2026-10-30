import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listStandardsCatalogue = vi.fn();
const listStandardsSubscriptions = vi.fn();
const registerPlatformSigningKey = vi.fn();
const publishStandardsPack = vi.fn();
const rolloutStandardsPack = vi.fn();
const buildSignedStandardsPack = vi.fn();
const generateSigningKey = vi.fn();
const listTenantsFn = vi.fn();

vi.mock('../../data/standards', () => ({
  listStandardsCatalogue: () => listStandardsCatalogue(),
  listStandardsSubscriptions: () => listStandardsSubscriptions(),
  registerPlatformSigningKey: (...a: unknown[]) => registerPlatformSigningKey(...a),
  publishStandardsPack: (...a: unknown[]) => publishStandardsPack(...a),
  rolloutStandardsPack: (...a: unknown[]) => rolloutStandardsPack(...a),
  buildSignedStandardsPack: (...a: unknown[]) => buildSignedStandardsPack(...a),
  generateSigningKey: (...a: unknown[]) => generateSigningKey(...a),
  SHIPPED_RULES: [{ id: 'a' }, { id: 'b' }],
}));
vi.mock('../../data/platform', () => ({ listTenants: () => listTenantsFn() }));

import { SuperAdminStandards } from './SuperAdminStandards';

const CATALOGUE = [
  { packId: 'standards.forensic.core', version: 1, title: 'Forensic core', discipline: 'management', sources: [], scopes: ['population'], contentHash: 'a'.repeat(64), keyId: 'k', releasedAt: '2026-01-01T00:00:00Z' },
];

const TENANTS = [
  { id: 'org-a', name: 'Tenant A', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' },
  { id: 'org-b', name: 'Tenant B', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' },
];

describe('SA-21 standards distribution (D16)', () => {
  beforeEach(() => {
    listStandardsCatalogue.mockResolvedValue(CATALOGUE);
    listStandardsSubscriptions.mockResolvedValue([
      { packId: 'standards.forensic.core', version: 1, pinned: false, reason: null, appliedAt: '2026-01-01T00:00:00Z' },
    ]);
    listTenantsFn.mockResolvedValue(TENANTS);
    registerPlatformSigningKey.mockResolvedValue({ ok: true });
    publishStandardsPack.mockResolvedValue({ ok: true });
    buildSignedStandardsPack.mockResolvedValue({
      ok: true, signed: { contentHash: 'b'.repeat(64) }, verification: { ok: true, refusal: null, reason: null },
    });
    generateSigningKey.mockResolvedValue({ publicKeyHex: 'aa', privateKey: { kty: 'OKP' } });
    rolloutStandardsPack.mockResolvedValue({
      ok: true, data: { applied: 1, results: [{ orgId: 'org-a', outcome: 'applied' }, { orgId: 'org-b', outcome: 'skipped-not-entitled' }] },
    });
  });

  it('shows the catalogue, the subscribed version and the tenants', async () => {
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('superadmin-standards')).toBeTruthy());
    expect(screen.getByTestId('standards-catalogue-standards.forensic.core')).toBeTruthy();
    expect(screen.getByTestId('standards-subscription-standards.forensic.core').textContent).toContain('v1');
    expect(screen.getByTestId('standards-rollout-org-a')).toBeTruthy();
    expect(screen.getByTestId('standards-shipped-rules').textContent).toContain('2');
  });

  it('refuses a rollout with no tenant chosen and sends nothing', async () => {
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-rollout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('standards-rollout'));
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('at least one tenant'));
    expect(rolloutStandardsPack).not.toHaveBeenCalled();
  });

  it('rolls out to the chosen tenants and shows the per-tenant outcome', async () => {
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-rollout-org-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('standards-rollout-org-a'));
    fireEvent.click(screen.getByTestId('standards-rollout-org-b'));
    fireEvent.click(screen.getByTestId('standards-rollout'));
    await waitFor(() => expect(rolloutStandardsPack).toHaveBeenCalledWith('standards.forensic.core', 1, ['org-a', 'org-b']));
    await waitFor(() => {
      const text = screen.getByTestId('superadmin-standards-result').textContent ?? '';
      expect(text).toContain('Applied to 1 of 2');
      expect(text).toContain('skipped-not-entitled');
    });
  });

  it('shows the exact refusal when the server refuses a rollout', async () => {
    rolloutStandardsPack.mockResolvedValue({ ok: false, reason: 'unknown_pack' });
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-rollout-org-a')).toBeTruthy());
    fireEvent.click(screen.getByTestId('standards-rollout-org-a'));
    fireEvent.click(screen.getByTestId('standards-rollout'));
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('unknown_pack'));
  });

  it('signs and publishes a pack, naming the content hash', async () => {
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-publish')).toBeTruthy());
    fireEvent.change(screen.getByTestId('standards-publish-version'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('standards-publish'));
    await waitFor(() => expect(publishStandardsPack).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('Published'));
    expect(buildSignedStandardsPack).toHaveBeenCalledWith(expect.anything(), 'standards.forensic.core', 2, expect.any(String), expect.any(String), expect.anything());
  });

  it('refuses a publish when the pack does not verify locally', async () => {
    buildSignedStandardsPack.mockResolvedValue({
      ok: true, signed: { contentHash: 'b'.repeat(64) }, verification: { ok: false, refusal: 'content_changed', reason: 'content hash does not match the signed hash' },
    });
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-publish')).toBeTruthy());
    fireEvent.click(screen.getByTestId('standards-publish'));
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('content hash does not match'));
    expect(publishStandardsPack).not.toHaveBeenCalled();
  });

  it('refuses a publish of a declared pack with no released rules', async () => {
    buildSignedStandardsPack.mockResolvedValue({ ok: false, reason: 'standards.shariah.aaoifi has no released rules yet' });
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-publish')).toBeTruthy());
    fireEvent.click(screen.getByTestId('standards-publish'));
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('no released rules'));
    expect(publishStandardsPack).not.toHaveBeenCalled();
  });

  it('refuses a version below 1 without signing', async () => {
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-publish-version')).toBeTruthy());
    fireEvent.change(screen.getByTestId('standards-publish-version'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('standards-publish'));
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-result').textContent).toContain('1 or more'));
    expect(generateSigningKey).not.toHaveBeenCalled();
  });

  it('shows the empty state when there are no tenants', async () => {
    listTenantsFn.mockResolvedValue([]);
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('superadmin-standards-empty')).toBeTruthy());
  });

  it('shows the empty subscriptions state when nothing is rolled out', async () => {
    listStandardsSubscriptions.mockResolvedValue([]);
    render(<SuperAdminStandards />);
    await waitFor(() => expect(screen.getByTestId('standards-subscriptions-empty')).toBeTruthy());
  });
});
