import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// A signed-in account with no org membership: loadCurrentUser throws and platformWhoami says no.
// Without the D4 fix the shell stayed on the loading spinner forever.
vi.mock('./data/client', () => ({
  loadCurrentUser: vi.fn().mockRejectedValue(new Error('This account is not provisioned in an organisation.')),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./data/platform', () => ({
  platformWhoami: vi.fn().mockResolvedValue({ userId: null, isPlatformAdmin: false }),
}));

import App from './App';

afterEach(() => cleanup());

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
});
