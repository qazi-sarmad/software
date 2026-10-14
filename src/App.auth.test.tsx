import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import App from './App';
import { initialUsers } from './data/initialData';

afterEach(() => cleanup());

const emailInput = () => screen.getByLabelText('Email') as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

const signInAs = async (email: string) => {
  render(<App />);
  await screen.findByTestId('temp-signin-form');
  fireEvent.change(emailInput(), { target: { value: email } });
  submit();
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Navigation Strip' })).toBeDefined());
};

describe('no session: sign-in screen and no data', () => {
  it('shows the sign-in screen with no header, no navigation and no application data', async () => {
    render(<App />);
    expect(screen.getByTestId('signin-screen')).toBeDefined();
    await screen.findByTestId('temp-signin-form');
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Navigation Strip' })).toBeNull();
    expect(screen.queryByRole('main')).toBeNull();
    // Nothing from the seed is on screen: no user, no entity, no engagement.
    const text = document.body.textContent || '';
    for (const u of initialUsers) {
      expect(text).not.toContain(u.name);
      expect(text).not.toContain(u.email);
    }
    expect(text).not.toContain('Executive Summary');
  });

  it('does not list accounts to choose from: there is no account picker', async () => {
    render(<App />);
    await screen.findByTestId('temp-signin-form');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    // The only buttons are the single Sign in button.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign in']);
  });

  it('marks the stub as TEMP_AUTH in development', async () => {
    render(<App />);
    expect((await screen.findByTestId('temp-auth-notice')).textContent).toContain('TEMP_AUTH');
  });

  it('rejects an empty email and stays signed out', async () => {
    render(<App />);
    await screen.findByTestId('temp-signin-form');
    submit();
    expect((await screen.findByTestId('signin-error')).textContent).toMatch(/Enter the email/);
    expect(screen.getByTestId('signin-screen')).toBeDefined();
  });

  it('rejects an account that is not in the demo tenant: no access, no default role', async () => {
    render(<App />);
    await screen.findByTestId('temp-signin-form');
    fireEvent.change(emailInput(), { target: { value: 'nobody@example.com' } });
    submit();
    expect((await screen.findByTestId('signin-error')).textContent).toMatch(/not provisioned/);
    expect(screen.queryByRole('navigation', { name: 'Navigation Strip' })).toBeNull();
    expect(screen.getByTestId('signin-screen')).toBeDefined();
  });
});

describe('with a session', () => {
  it('admits a demo-tenant account and shows exactly the 7 tabs, with no Reports tab', async () => {
    await signInAs(initialUsers[0].email);
    const nav = screen.getByRole('navigation', { name: 'Navigation Strip' });
    const titles = within(nav).getAllByRole('button').map((b) => b.getAttribute('title'));
    expect(titles).toEqual([
      'Executive Summary',
      'Pending Tasks',
      'Audit Universe',
      'Audit Plan',
      'SIRA',
      'Audit File',
      'Issues Register',
    ]);
    expect(within(nav).queryByText('Reports')).toBeNull();
  });

  it('the profile menu has no viewpoint simulation, no account list and no dev link', async () => {
    await signInAs(initialUsers[0].email);
    fireEvent.click(screen.getByLabelText('Open user profile menu'));
    await screen.findByText('Sign out');
    const text = document.body.textContent || '';
    expect(text).not.toContain('Simulate Viewpoint');
    expect(text).not.toContain('/dev/access');
    expect(text).not.toContain('Team & permissions');
    // The signed-in user's own name appears; the other accounts do not.
    for (const u of initialUsers.slice(1)) {
      expect(text).not.toContain(`${u.name} (${u.role})`);
    }
  });

  it('signs in as the account that was entered, not as a default user', async () => {
    const observer = initialUsers.find((u) => u.role === 'observer')!;
    await signInAs(observer.email);
    fireEvent.click(screen.getByLabelText('Open user profile menu'));
    await screen.findByText('Sign out');
    expect(document.body.textContent).toContain(observer.email);
    expect(document.body.textContent).not.toContain(initialUsers[0].email);
  });

  it('Sign out returns to the sign-in screen and unmounts all data', async () => {
    await signInAs(initialUsers[0].email);
    fireEvent.click(screen.getByLabelText('Open user profile menu'));
    fireEvent.click(await screen.findByText('Sign out'));
    await screen.findByTestId('signin-screen');
    expect(screen.queryByRole('navigation', { name: 'Navigation Strip' })).toBeNull();
    expect(document.body.textContent).not.toContain(initialUsers[0].email);
  });
});
