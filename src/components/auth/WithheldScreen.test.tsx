import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const refreshSession = vi.fn().mockResolvedValue(undefined);
const signOut = vi.fn().mockResolvedValue(undefined);
let withheld: 'mfa_required' | 'sso_required' | null = 'sso_required';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ withheld, refreshSession, signOut }),
}));

// The MFA path delegates to the shared challenge; stub it so this test is about the gate, not TOTP.
vi.mock('./MfaChallenge', () => ({
  MfaChallenge: ({ title }: { title?: string }) => <div data-testid="mfa-challenge">{title}</div>,
}));

import { WithheldScreen } from './WithheldScreen';

describe('withheld session screen (0100 SSO, 0103 second factor)', () => {
  it('offers the challenge when the organisation requires a second factor', () => {
    withheld = 'mfa_required';
    render(<WithheldScreen />);
    expect(screen.getByTestId('mfa-challenge')).toBeTruthy();
    expect(screen.queryByTestId('withheld-screen')).toBeNull();
  });

  it('shows the SSO guidance when the organisation requires single sign-on', () => {
    withheld = 'sso_required';
    render(<WithheldScreen />);
    expect(screen.getByTestId('withheld-screen')).toBeTruthy();
    expect(screen.queryByTestId('mfa-challenge')).toBeNull();
  });

  it('re-resolves the session when the member retries', () => {
    withheld = 'sso_required';
    refreshSession.mockClear();
    render(<WithheldScreen />);
    fireEvent.click(screen.getByTestId('withheld-retry'));
    expect(refreshSession).toHaveBeenCalled();
  });

  it('signs the member out on request', () => {
    withheld = 'sso_required';
    signOut.mockClear();
    render(<WithheldScreen />);
    fireEvent.click(screen.getByTestId('withheld-signout'));
    expect(signOut).toHaveBeenCalled();
  });
});
