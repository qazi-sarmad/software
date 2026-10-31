import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listUniversesWithDiscipline = vi.fn();
const seedDefaultUniverses = vi.fn();
const setUniverseDomain = vi.fn();
const universeDiscipline = vi.fn();
const listTenantsFn = vi.fn();

vi.mock('../../data/platformDomains', () => ({
  listUniversesWithDiscipline: () => listUniversesWithDiscipline(),
  seedDefaultUniverses: (...a: unknown[]) => seedDefaultUniverses(...a),
  setUniverseDomain: (...a: unknown[]) => setUniverseDomain(...a),
  universeDiscipline: (...a: unknown[]) => universeDiscipline(...a),
}));
vi.mock('../../data/platform', () => ({ listTenants: () => listTenantsFn() }));

import { SuperAdminDomains } from './SuperAdminDomains';

const TENANTS = [
  { id: 'org-a', name: 'Tenant A', status: 'active', aiEnabled: false, featureFlags: {}, createdAt: '' },
];

const UNIVERSES = [
  { id: 'u1', name: 'Management Audit', domain: 'management', discipline: 'management' },
  { id: 'u2', name: "Shari'ah Audit", domain: 'shariah', discipline: 'shariah' },
  { id: 'u3', name: 'IT Audit', domain: 'it', discipline: 'it' },
  { id: 'u4', name: 'Legacy', domain: 'something_odd', discipline: null },
];

describe('SA-19 audit domains (D11)', () => {
  beforeEach(() => {
    listTenantsFn.mockResolvedValue(TENANTS);
    listUniversesWithDiscipline.mockResolvedValue(UNIVERSES);
    seedDefaultUniverses.mockResolvedValue({ ok: true, added: 3, universes: UNIVERSES.slice(0, 3) });
    setUniverseDomain.mockResolvedValue({ ok: true });
    // The read-back RPC answers the server's own value; 'u4' (legacy) has none.
    universeDiscipline.mockImplementation((id: string) =>
      Promise.resolve(UNIVERSES.find((u) => u.id === id)?.discipline ?? null));
  });

  it('lists the universes with their resolved discipline, and flags an unknown domain', async () => {
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());

    // Before a tenant is chosen, the universe list is not shown.
    expect(screen.queryByTestId('sa-domains-list')).toBeNull();

    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-domains-list')).toBeTruthy());

    expect(screen.getByTestId('sa-domains-row-u1')).toBeTruthy();
    // An unknown/legacy domain is shown as unset, never silently mapped to a default.
    expect(screen.getByTestId('sa-domains-unset-u4').textContent).toContain('something_odd');
    // The discipline is read back through the server RPC, and a legacy universe has no answer.
    expect(screen.getByTestId('sa-domains-readback-u1').textContent).toBe('management');
    expect(screen.getByTestId('sa-domains-readback-u4').textContent).toBe('—');
  });

  it('shows the rule base each discipline runs, read from the engine', async () => {
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());

    // The three selectable disciplines each have a base card with a rule count.
    for (const d of ['management', 'it', 'shariah']) {
      const card = screen.getByTestId(`sa-domains-basecard-${d}`);
      expect(card).toBeTruthy();
      const count = screen.getByTestId(`sa-domains-basecount-${d}`).textContent ?? '';
      expect(count).toMatch(/\d+ released rule/);
    }
    // The IT and Shari'ah bases cite their sources (the honesty rule).
    expect(screen.getByTestId('sa-domains-basestandards-it').textContent).toContain('COBIT 2019');
    expect(screen.getByTestId('sa-domains-basestandards-shariah').textContent).toContain('AAOIFI SS 1');
  });

  it('seeds the three defaults and reports the count', async () => {
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });

    fireEvent.click(screen.getByTestId('sa-domains-seed'));
    await waitFor(() => expect(seedDefaultUniverses).toHaveBeenCalledWith('org-a'));
    await waitFor(() => expect(screen.getByTestId('sa-domains-notice').textContent).toContain('Seeded 3'));
  });

  it('reports an idempotent seed honestly', async () => {
    seedDefaultUniverses.mockResolvedValue({ ok: true, added: 0, universes: UNIVERSES.slice(0, 3) });
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });

    fireEvent.click(screen.getByTestId('sa-domains-seed'));
    await waitFor(() => expect(screen.getByTestId('sa-domains-notice').textContent).toContain('already exist'));
  });

  it('refuses to set a discipline without a reason (the form guard)', async () => {
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-domains-row-u1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sa-domains-edit-u1'));
    fireEvent.click(screen.getByTestId('sa-domains-save'));
    await waitFor(() => expect(screen.getByTestId('sa-domains-action-error').textContent).toContain('reason'));
    expect(setUniverseDomain).not.toHaveBeenCalled();
  });

  it('sets a discipline with a reason and surfaces the server refusal', async () => {
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-domains-row-u1')).toBeTruthy());

    fireEvent.click(screen.getByTestId('sa-domains-edit-u1'));
    fireEvent.change(screen.getByTestId('sa-domains-domain-input'), { target: { value: 'forensic' } });
    fireEvent.change(screen.getByTestId('sa-domains-reason'), { target: { value: 'a fourth discipline' } });
    fireEvent.click(screen.getByTestId('sa-domains-save'));
    await waitFor(() => expect(setUniverseDomain).toHaveBeenCalledWith('u1', 'forensic', 'a fourth discipline'));
    await waitFor(() => expect(screen.getByTestId('sa-domains-notice').textContent).toContain('forensic'));

    // A server refusal is surfaced, never shown as success.
    setUniverseDomain.mockResolvedValue({ ok: false, reason: 'that universe does not exist in your organisation' });
    fireEvent.click(screen.getByTestId('sa-domains-edit-u2'));
    fireEvent.change(screen.getByTestId('sa-domains-reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('sa-domains-save'));
    await waitFor(() => expect(screen.getByTestId('sa-domains-action-error').textContent).toContain('does not exist'));
  });

  it('shows an empty state when the organisation has no universe', async () => {
    listUniversesWithDiscipline.mockResolvedValue([]);
    render(<SuperAdminDomains />);
    await waitFor(() => expect(screen.getByTestId('sa-domains')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-domains-org-select'), { target: { value: 'org-a' } });
    await waitFor(() => expect(screen.getByTestId('sa-domains-empty')).toBeTruthy());
  });
});
