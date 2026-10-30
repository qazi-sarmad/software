import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listTimestampAuthorities = vi.fn();
const listTrustAnchors = vi.fn();
const saveTimestampAuthority = vi.fn();
const saveTrustAnchor = vi.fn();
const setAnchoringMin = vi.fn();
const listTenants = vi.fn();

vi.mock('../../data/integrityAnchoring', () => ({
  listTimestampAuthorities: () => listTimestampAuthorities(),
  listTrustAnchors: () => listTrustAnchors(),
  saveTimestampAuthority: (...a: unknown[]) => saveTimestampAuthority(...a),
  saveTrustAnchor: (...a: unknown[]) => saveTrustAnchor(...a),
  setAnchoringMin: (...a: unknown[]) => setAnchoringMin(...a),
}));
vi.mock('../../data/platform', () => ({ listTenants: () => listTenants() }));

import { IntegrityAnchoringPanel } from './IntegrityAnchoringPanel';

describe('SA-18 integrity anchoring (Phase 3.5)', () => {
  beforeEach(() => {
    listTimestampAuthorities.mockResolvedValue([]);
    listTrustAnchors.mockResolvedValue([]);
    listTenants.mockResolvedValue([]);
    saveTimestampAuthority.mockResolvedValue({ ok: true });
    saveTrustAnchor.mockResolvedValue({ ok: true });
    setAnchoringMin.mockResolvedValue({ ok: true });
  });

  it('renders the three empty catalogues', async () => {
    render(<IntegrityAnchoringPanel />);
    await waitFor(() => expect(screen.getByTestId('sa-anchoring')).toBeTruthy());
    expect(screen.getByTestId('sa-anchoring-authority-empty')).toBeTruthy();
    expect(screen.getByTestId('sa-anchoring-anchor-empty')).toBeTruthy();
    expect(screen.getByTestId('sa-anchoring-min-empty')).toBeTruthy();
  });

  it('lists the authorities and anchors the database holds', async () => {
    listTimestampAuthorities.mockResolvedValue([
      { id: 'a1', name: 'FreeTSA', url: 'https://freetsa.org', enabled: true, sortOrder: 10, notes: null },
    ]);
    listTrustAnchors.mockResolvedValue([{ id: 't1', name: 'Root CA', enabled: true }]);
    render(<IntegrityAnchoringPanel />);
    await waitFor(() => expect(screen.getByTestId('sa-anchoring-authority-a1')).toBeTruthy());
    expect(screen.getByTestId('sa-anchoring-authority-a1').textContent).toContain('FreeTSA');
    expect(screen.getByTestId('sa-anchoring-anchor-t1').textContent).toContain('Root CA');
  });

  it('saves a new authority through the writer RPC', async () => {
    render(<IntegrityAnchoringPanel />);
    await waitFor(() => expect(screen.getByTestId('sa-anchoring-authority-add')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-anchoring-authority-name'), { target: { value: 'FreeTSA' } });
    fireEvent.change(screen.getByTestId('sa-anchoring-authority-url'), { target: { value: 'https://freetsa.org' } });
    fireEvent.click(screen.getByTestId('sa-anchoring-authority-add'));
    await waitFor(() => expect(saveTimestampAuthority).toHaveBeenCalled());
    expect(saveTimestampAuthority.mock.calls[0][1]).toBe('FreeTSA');
  });

  it('sets a tenant minimum through the setter RPC', async () => {
    listTenants.mockResolvedValue([{ id: 'org-a', name: 'Acme' }]);
    render(<IntegrityAnchoringPanel />);
    await waitFor(() => expect(screen.getByTestId('sa-anchoring-min-org-a-3')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-anchoring-min-org-a-3'));
    await waitFor(() => expect(setAnchoringMin).toHaveBeenCalledWith('org-a', 3));
  });

  it('surfaces a database refusal instead of pretending success', async () => {
    listTenants.mockResolvedValue([{ id: 'org-a', name: 'Acme' }]);
    setAnchoringMin.mockResolvedValue({ ok: false, reason: 'not allowed: platform administrator only' });
    render(<IntegrityAnchoringPanel />);
    await waitFor(() => expect(screen.getByTestId('sa-anchoring-min-org-a-2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-anchoring-min-org-a-2'));
    await waitFor(() =>
      expect(screen.getByTestId('sa-anchoring-save-error').textContent).toContain('platform administrator only'));
  });
});
