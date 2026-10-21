import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const acceptMemberInvite = vi.fn();
const createInviteeAccount = vi.fn();
const refreshSession = vi.fn();
let authState = { status: 'signed_out' as string, user: null as unknown };

vi.mock('../../data/admin', () => ({
  acceptMemberInvite: (t: string) => acceptMemberInvite(t),
  createInviteeAccount: (e: string, p: string) => createInviteeAccount(e, p),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    status: authState.status,
    user: authState.user,
    refreshSession,
  }),
}));

import { MemberAccept } from './MemberAccept';

describe('OA-20 member invitation acceptance (C2.4)', () => {
  beforeEach(() => {
    authState = { status: 'signed_out', user: null };
    acceptMemberInvite.mockReset().mockResolvedValue({ ok: true });
    createInviteeAccount.mockReset().mockResolvedValue({ ok: true, sessionStarted: true });
    refreshSession.mockReset().mockResolvedValue(undefined);
  });

  it('pre-fills the invitation code from the link and renders no JSON input', () => {
    render(<MemberAccept tokenFromUrl="tok-123" />);
    expect(screen.getByTestId('oa-accept')).toBeTruthy();
    expect((screen.getByTestId('oa-accept-token') as HTMLInputElement).value).toBe('tok-123');
    expect(screen.getByTestId('oa-accept').textContent).not.toContain('JSON');
  });

  it('creates the account, accepts the invitation and reports success', async () => {
    render(<MemberAccept tokenFromUrl="tok-abc" />);
    fireEvent.change(screen.getByTestId('oa-accept-email'), { target: { value: 'new.person@example.test' } });
    fireEvent.change(screen.getByTestId('oa-accept-password'), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-done')).toBeTruthy());
    expect(createInviteeAccount).toHaveBeenCalledWith('new.person@example.test', 'a-long-enough-password');
    expect(acceptMemberInvite).toHaveBeenCalledWith('tok-abc');
    expect(refreshSession).toHaveBeenCalled();
  });

  it('shows the database reason when the invitation cannot be accepted', async () => {
    acceptMemberInvite.mockResolvedValue({ ok: false, reason: 'this invitation has expired' });
    render(<MemberAccept tokenFromUrl="tok-exp" />);
    fireEvent.change(screen.getByTestId('oa-accept-email'), { target: { value: 'late@example.test' } });
    fireEvent.change(screen.getByTestId('oa-accept-password'), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-error').textContent).toContain('expired'));
  });

  it('is honest when the project requires email confirmation (no session yet)', async () => {
    createInviteeAccount.mockResolvedValue({ ok: true, sessionStarted: false });
    render(<MemberAccept tokenFromUrl="tok-conf" />);
    fireEvent.change(screen.getByTestId('oa-accept-email'), { target: { value: 'confirm.me@example.test' } });
    fireEvent.change(screen.getByTestId('oa-accept-password'), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-error').textContent).toContain('Confirm'));
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });

  it('refuses a short password before calling the database', async () => {
    render(<MemberAccept tokenFromUrl="tok-short" />);
    fireEvent.change(screen.getByTestId('oa-accept-email'), { target: { value: 'short@example.test' } });
    fireEvent.change(screen.getByTestId('oa-accept-password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-error').textContent).toContain('eight'));
    expect(createInviteeAccount).not.toHaveBeenCalled();
  });

  it('accepts directly when the invitee is already signed in (no account form)', async () => {
    authState = { status: 'signed_in', user: { id: 'u-1' } };
    render(<MemberAccept tokenFromUrl="tok-signed" />);
    expect(screen.queryByTestId('oa-accept-email')).toBeNull();
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-done')).toBeTruthy());
    expect(createInviteeAccount).not.toHaveBeenCalled();
    expect(acceptMemberInvite).toHaveBeenCalledWith('tok-signed');
  });

  it('reports a missing code instead of sending an empty token', async () => {
    render(<MemberAccept tokenFromUrl="" />);
    fireEvent.change(screen.getByTestId('oa-accept-email'), { target: { value: 'nobody@example.test' } });
    fireEvent.change(screen.getByTestId('oa-accept-password'), { target: { value: 'a-long-enough-password' } });
    fireEvent.click(screen.getByTestId('oa-accept-submit'));

    await waitFor(() => expect(screen.getByTestId('oa-accept-error').textContent).toContain('missing'));
    expect(acceptMemberInvite).not.toHaveBeenCalled();
  });
});
