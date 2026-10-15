import { describe, expect, it } from 'vitest';
import { initials, loadCurrentUser, signIn } from './client';

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
});
