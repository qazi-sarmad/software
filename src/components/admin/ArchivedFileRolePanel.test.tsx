import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getRoleFn = vi.fn();
const setRoleFn = vi.fn();
const listCustodiansFn = vi.fn();
const listRolesFn = vi.fn();

vi.mock('../../data/fileOwnership', () => ({
  getArchivedFileRole: () => getRoleFn(),
  setArchivedFileRole: (...a: unknown[]) => setRoleFn(...a),
  listArchivedFileCustodians: () => listCustodiansFn(),
  listCustodianRoles: () => listRolesFn(),
  listFileOwnerAudit: () => Promise.resolve([]),
}));

const orgRoles = [
  { slug: 'cia', name: 'CIA', why: 'The accountable head of the function. The platform default.' },
  { slug: 'org_admin', name: 'Org Admin', why: 'The organisation administrator.' },
  { slug: 'audit_manager', name: 'Audit Manager', why: 'The manager accountable for the engagement.' },
  { slug: 'reviewer', name: 'Reviewer', why: 'The independent reviewer.' },
  { slug: 'forensic_lead', name: 'Forensic Lead', why: '' },
];

const userRef = { current: { role: 'cia', rights: { manage_roles: true }, orgId: 'org-1' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { ArchivedFileRolePanel } from './ArchivedFileRolePanel';

const admin = { role: 'cia', rights: { manage_roles: true }, orgId: 'org-1' };
const observer = { role: 'observer', rights: { read_only: true } };

const defaultRole = {
  roleSlug: 'cia', roleName: 'CIA', isDefault: true, version: 1,
  reason: 'the platform default', updatedAt: null,
};

describe('ArchivedFileRolePanel (OA-41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userRef.current = admin as never;
    getRoleFn.mockResolvedValue(defaultRole);
    listCustodiansFn.mockResolvedValue([]);
    listRolesFn.mockResolvedValue(orgRoles);
    setRoleFn.mockResolvedValue(1);
  });

  it('shows a loading state while the configuration is read', () => {
    getRoleFn.mockReturnValue(new Promise(() => {}));
    listCustodiansFn.mockReturnValue(new Promise(() => {}));
    listRolesFn.mockReturnValue(new Promise(() => {}));
    render(<ArchivedFileRolePanel />);
    expect(screen.getByTestId('archived-role-loading')).toBeTruthy();
  });

  it('offers the organisation\'s real roles, including its own, not a hard-coded list', async () => {
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-select')).toBeTruthy());
    fireEvent.click(screen.getByTestId('archived-role-select'));
    await waitFor(() => expect(screen.getByText('Forensic Lead')).toBeTruthy());
    expect(screen.getAllByText('CIA').length).toBeGreaterThan(0);
    expect(screen.getByText('Org Admin')).toBeTruthy();
  });

  it('shows the custodian role in force and the platform default', async () => {
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-value').textContent).toBe('CIA'));
    expect(screen.getByTestId('archived-role-version').textContent).toContain('platform default');
  });

  it('is read-only without manage_roles, and offers no form', async () => {
    userRef.current = observer as never;
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-readonly')).toBeTruthy());
    expect(screen.queryByTestId('archived-role-form')).toBeNull();
  });

  it('refuses a change with a short reason', async () => {
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('archived-role-select'));
    // The Select is a listbox; choose Audit Manager by its visible label.
    fireEvent.click(await screen.findByText('Audit Manager'));
    fireEvent.change(screen.getByTestId('archived-role-reason-input'), { target: { value: 'short' } });
    expect(screen.getByTestId('archived-role-save')).toHaveProperty('disabled', true);
    expect(setRoleFn).not.toHaveBeenCalled();
  });

  it('saves a versioned change and reports the version', async () => {
    setRoleFn.mockResolvedValue(2);
    getRoleFn
      .mockResolvedValueOnce(defaultRole)
      .mockResolvedValue({
        roleSlug: 'audit_manager', roleName: 'Audit Manager', isDefault: false,
        version: 2, reason: 'the custodian moves', updatedAt: '2026-10-30T00:00:00Z',
      });
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('archived-role-select'));
    fireEvent.click(await screen.findByText('Audit Manager'));
    fireEvent.change(screen.getByTestId('archived-role-reason-input'), {
      target: { value: 'the custodian moves to the audit manager' },
    });
    fireEvent.click(screen.getByTestId('archived-role-save'));
    await waitFor(() => expect(setRoleFn).toHaveBeenCalledWith('audit_manager', 'the custodian moves to the audit manager'));
    await waitFor(() => expect(screen.getByTestId('archived-role-notice').textContent).toContain('version 2'));
  });

  it('surfaces a refused write as an inline error', async () => {
    setRoleFn.mockRejectedValue(new Error('manage_roles'));
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('archived-role-select'));
    fireEvent.click(await screen.findByText('Reviewer'));
    fireEvent.change(screen.getByTestId('archived-role-reason-input'), {
      target: { value: 'a reason long enough to pass' },
    });
    fireEvent.click(screen.getByTestId('archived-role-save'));
    await waitFor(() => expect(screen.getByTestId('archived-role-error')).toBeTruthy());
  });

  it('shows a designed empty state before any file is archived', async () => {
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-archives-empty')).toBeTruthy());
  });

  it('lists archived files with their custodian role and owner', async () => {
    listCustodiansFn.mockResolvedValue([{
      archiveId: 'a1', populationId: 'p1', engagementId: 'e1', status: 'done',
      contentHash: 'ab'.repeat(32), archivedRowCount: 5, custodianRoleSlug: 'audit_manager',
      custodianRoleName: 'Audit Manager', ownerUserId: 'u1', ownerName: 'Preparer One',
      createdAt: '2026-10-30T00:00:00Z',
    }]);
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-archive-a1')).toBeTruthy());
    expect(screen.getByTestId('archived-role-archive-a1').textContent).toContain('Audit Manager');
    expect(screen.getByTestId('archived-role-archive-a1').textContent).toContain('Preparer One');
  });

  it('shows a load error when the configuration cannot be read', async () => {
    getRoleFn.mockRejectedValue(new Error('network'));
    render(<ArchivedFileRolePanel />);
    await waitFor(() => expect(screen.getByTestId('archived-role-load-error')).toBeTruthy());
  });
});
