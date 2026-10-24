import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';
import { initialUsers } from './data/initialData';

afterEach(() => cleanup());

describe('no session: sign-in screen and no data', () => {
  it('shows the sign-in screen with email and password fields and no application data', async () => {
    render(<App />);
    expect(await screen.findByTestId('signin-screen')).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Password')).toBeDefined();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Navigation Strip' })).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
    const text = document.body.textContent || '';
    for (const u of initialUsers) {
      expect(text).not.toContain(u.name);
      expect(text).not.toContain(u.email);
    }
    expect(text).not.toContain('Dashboard');
  });

  it('has exactly one button, Sign in', async () => {
    render(<App />);
    await screen.findByTestId('signin-screen');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
  });
});
