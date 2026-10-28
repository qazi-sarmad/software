import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// A signed-in account with no org membership: loadCurrentUser throws and platformWhoami says no.
// Without the D4 fix the shell stayed on the loading spinner forever.
vi.mock('./data/client', () => ({
  loadCurrentUser: vi.fn().mockRejectedValue(new Error('This account is not provisioned in an organisation.')),
  refreshAuthToken: vi.fn().mockResolvedValue(true),
  signIn: vi.fn(),
  signOut: vi.fn(),
  hasSupabaseConfig: () => false,
}));
vi.mock('./data/platform', () => ({
  platformWhoami: vi.fn().mockResolvedValue({ userId: null, isPlatformAdmin: false }),
}));

import App from './App';
import { refreshAuthToken } from './data/client';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('signed in but not in an organisation (D4)', () => {
  it('renders the welcome screen with a Refresh action and no application data', async () => {
    render(<App />);
    expect(await screen.findByTestId('no-tenant-screen')).toBeDefined();
    expect(screen.getByText('Welcome to Provio')).toBeDefined();
    expect(screen.getByTestId('no-tenant-refresh')).toBeDefined();
    // The application shell is not mounted: no nav strip, no main region.
    expect(screen.queryByRole('navigation', { name: 'Navigation Strip' })).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
  });

  // C2.4: the org claim lives in the JWT, so re-reading the session alone cannot reveal a membership
  // added after sign-in. Refresh must re-mint the token, or the colleague stays stuck on this screen.
  it('Refresh re-mints the access token before resolving, not just re-reads the session', async () => {
    render(<App />);
    await screen.findByTestId('no-tenant-screen');
    vi.mocked(refreshAuthToken).mockClear();
    fireEvent.click(screen.getByTestId('no-tenant-refresh'));
    await waitFor(() => expect(refreshAuthToken).toHaveBeenCalled());
  });
});
