import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const listMembersFn = vi.fn();
const listRolesFn = vi.fn();
const listScopesFn = vi.fn();
const inviteUserFn = vi.fn();

vi.mock('../../data/admin', () => ({
  listMembers: () => listMembersFn(),
  listRoles: () => listRolesFn(),
  listScopes: () => listScopesFn(),
  inviteUser: (...a: unknown[]) => inviteUserFn(...a),
  provisionMember: () => Promise.resolve({ ok: true }),
  setMemberRole: () => Promise.resolve({ ok: true }),
  setMemberManager: () => Promise.resolve({ ok: true }),
  grantScope: () => Promise.resolve({ ok: true }),
  revokeScope: () => Promise.resolve({ ok: true }),
  createRole: () => Promise.resolve({ ok: true }),
  updateRoleRights: () => Promise.resolve({ ok: true }),
  deleteRole: () => Promise.resolve({ ok: true }),
  setInviteCap: () => Promise.resolve({ ok: true }),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    currentUser: { id: 'u-admin', role: 'org_admin', rights: { manage_users: true, manage_roles: true } },
  }),
}));

import { PeopleAdminPanel } from './PeopleAdminPanel';

describe('People admin invite (D20)', () => {
  beforeEach(() => {
    listMembersFn.mockResolvedValue([]);
    listRolesFn.mockResolvedValue([
      { id: 'r1', slug: 'audit_manager', name: 'Audit Manager', isSeed: true, rights: {} },
    ]);
    listScopesFn.mockResolvedValue([]);
    inviteUserFn.mockReset();
    inviteUserFn.mockResolvedValue({ ok: true });
  });

  it('sends an invite with the email and the chosen role, and shows the confirmation', async () => {
    render(<PeopleAdminPanel />);
    await waitFor(() => expect(screen.getByTestId('admin-invite')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Enter email address'), {
      target: { value: 'new.auditor@example.test' },
    });
    fireEvent.click(screen.getByLabelText('Select role'));
    fireEvent.click(screen.getByText('Audit Manager'));
    fireEvent.click(screen.getByTestId('admin-invite'));

    await waitFor(() => expect(inviteUserFn).toHaveBeenCalledWith('new.auditor@example.test', 'audit_manager'));
    await waitFor(() =>
      expect(screen.getByTestId('admin-invite-sent').textContent).toContain(
        'Invitation sent to new.auditor@example.test',
      ),
    );
  });

  it('keeps the send button disabled until the email looks valid', async () => {
    render(<PeopleAdminPanel />);
    await waitFor(() => expect(screen.getByTestId('admin-invite')).toBeTruthy());
    const button = screen.getByTestId('admin-invite') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Enter email address'), { target: { value: 'nope' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Enter email address'), { target: { value: 'a@b.test' } });
    expect(button.disabled).toBe(false);
  });

  it('invites without a role when none is chosen', async () => {
    render(<PeopleAdminPanel />);
    await waitFor(() => expect(screen.getByTestId('admin-invite')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Enter email address'), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByTestId('admin-invite'));
    await waitFor(() => expect(inviteUserFn).toHaveBeenCalledWith('a@b.test', null));
  });
});
