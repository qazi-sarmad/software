import { describe, expect, it } from 'vitest';
import { initials, loadCurrentUser, refreshAuthToken, signIn } from './client';

describe('data client', () => {
  it('initials: two words', () => {
    expect(initials('Ayesha Khan')).toBe('AK');
  });
  it('initials: one word', () => {
    expect(initials('Sana')).toBe('S');
  });
  it('initials: empty', () => {
    expect(initials('')).toBe('');
  });
  it('signIn returns not configured when the environment variables are unset', async () => {
    expect(await signIn('a@b.invalid', 'x')).toEqual({ ok: false, reason: 'Sign-in is not configured.' });
  });
  it('loadCurrentUser returns null when the environment variables are unset', async () => {
    expect(await loadCurrentUser()).toBeNull();
  });
  // C2.4: the org/role claims live in the JWT, so a membership added after sign-in is invisible until
  // the token is re-minted. With no configured client there is nothing to re-mint, and the caller
  // must be told so rather than silently pretending the session advanced.
  it('refreshAuthToken reports failure when the environment variables are unset', async () => {
    expect(await refreshAuthToken()).toBe(false);
  });
});
