import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * The withheld-session wiring (0100 SSO, 0103 second factor).
 *
 * A signed-in session whose organisation enforces SSO or a second factor gets no org claims from the
 * access-token hook, so `loadCurrentUser` finds no membership. The shell must then read the withheld
 * flag off the token and show the matching screen, NOT the "welcome, not provisioned" screen.
 */
vi.mock('./data/client', () => ({
  loadCurrentUser: vi.fn().mockRejectedValue(new Error('This account is not provisioned in an organisation.')),
  refreshAuthToken: vi.fn().mockResolvedValue(true),
  sessionClaims: vi.fn().mockResolvedValue({ mfa_required: true }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  hasSupabaseConfig: () => false,
}));
vi.mock('./data/platform', () => ({
  platformWhoami: vi.fn().mockResolvedValue({ userId: null, isPlatformAdmin: false, isPlatformOwner: false, ownerExists: true }),
  getSecurityStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('./data/externalAuditors', () => ({
  isExternalAuditorSession: vi.fn().mockResolvedValue(false),
}));
// The challenge reaches Supabase Auth; stub it so this test is about the gate, not TOTP.
vi.mock('./components/auth/MfaChallenge', () => ({
  MfaChallenge: () => <div data-testid="mfa-challenge" />,
}));

import App from './App';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('withheld session wiring (0100, 0103)', () => {
  it('shows the second-factor challenge, not the welcome screen', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('mfa-challenge')).toBeTruthy());
    expect(screen.queryByTestId('no-tenant-screen')).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
  });
});
