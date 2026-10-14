import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_MODE, DEMO_TENANT, resolveTempAccount } from './tempAuth';
import { initialUsers } from '../data/initialData';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('TEMP_AUTH sign-in stub', () => {
  it('is marked TEMP_AUTH and bound to a tenant flagged is_demo', () => {
    expect(AUTH_MODE).toBe('TEMP_AUTH');
    expect(DEMO_TENANT.is_demo).toBe(true);
    expect(DEMO_TENANT.users.length).toBeGreaterThan(0);
  });

  it('accepts every account listed in the demo tenant and returns that exact user', () => {
    for (const u of initialUsers) {
      const r = resolveTempAccount(u.email);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.user).toBe(u);
    }
  });

  it('ignores case and surrounding whitespace', () => {
    const u = initialUsers[0];
    const r = resolveTempAccount(`  ${u.email.toUpperCase()}  `);
    expect(r.ok).toBe(true);
  });

  it('rejects an account that is not in the demo tenant: no access and no default role', () => {
    const r = resolveTempAccount('stranger@example.com');
    expect(r).toEqual({ ok: false, reason: 'This account is not provisioned. Access denied.' });
    expect((r as any).user).toBeUndefined();
  });

  it.each(['', '   ', '\n\t'])('rejects an empty email %j', (input) => {
    const r = resolveTempAccount(input);
    expect(r.ok).toBe(false);
  });

  it('rejects non-string input instead of throwing or defaulting', () => {
    expect(resolveTempAccount(undefined as unknown as string).ok).toBe(false);
    expect(resolveTempAccount(null as unknown as string).ok).toBe(false);
  });

  it('does not match on partial emails or on a user name', () => {
    expect(resolveTempAccount(initialUsers[0].email.split('@')[0]).ok).toBe(false);
    expect(resolveTempAccount(initialUsers[0].name).ok).toBe(false);
  });

  it('refuses accounts when the tenant is not a demo tenant', () => {
    const notDemo = { ...DEMO_TENANT, is_demo: false as unknown as true };
    expect(resolveTempAccount(initialUsers[0].email, notDemo).ok).toBe(false);
  });
});

describe('TEMP_AUTH must not exist in a production build', () => {
  it('throws at load time when import.meta.env.PROD is true', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    vi.resetModules();
    await expect(import('./tempAuth')).rejects.toThrow('TEMP_AUTH must not be present in a production build.');
  });

  it('loads normally outside production', async () => {
    vi.stubEnv('PROD', false);
    vi.resetModules();
    await expect(import('./tempAuth')).resolves.toHaveProperty('AUTH_MODE', 'TEMP_AUTH');
  });
});
