/**
 * TEMP_AUTH: temporary sign-in stub (Phase 0).
 *
 * There is no backend yet, so this accepts only accounts that are listed in the flagged demo tenant.
 * It is NOT authentication: there is no password and no session token. It exists so the prototype can be
 * entered at all once the default identity was removed. It is replaced by real Supabase Auth in the backend phase.
 *
 * Rules:
 *  - Development builds only. Nothing may import this module except behind an `import.meta.env.DEV` branch.
 *  - A production build must not contain it. This module throws at load time if it is ever evaluated
 *    when import.meta.env.PROD is true, and src/build/prodBundle.test.ts fails if "TEMP_AUTH" is found in dist.
 *  - An email that is not listed gets no access and no default role.
 */
import { initialUsers } from '../data/initialData';
import type { User } from '../types';

if (import.meta.env.PROD) {
  throw new Error('TEMP_AUTH must not be present in a production build.');
}

export const AUTH_MODE = 'TEMP_AUTH' as const;

export interface DemoTenant {
  id: string;
  name: string;
  /** Demo data exists only in a tenant flagged is_demo. */
  is_demo: true;
  users: readonly User[];
}

export const DEMO_TENANT: DemoTenant = {
  id: 'tenant-demo',
  name: 'Provio Demo Tenant',
  is_demo: true,
  users: initialUsers,
};

export type TempSignInResult = { ok: true; user: User } | { ok: false; reason: string };

/** Resolves an email to a user of the demo tenant. Never returns a default user. */
export function resolveTempAccount(email: string, tenant: DemoTenant = DEMO_TENANT): TempSignInResult {
  const normalised = (email ?? '').trim().toLowerCase();
  if (!normalised) {
    return { ok: false, reason: 'Enter the email address of a provisioned account.' };
  }
  const user = tenant.users.find((u) => u.email.trim().toLowerCase() === normalised);
  if (!tenant.is_demo || !user) {
    return { ok: false, reason: 'This account is not provisioned. Access denied.' };
  }
  return { ok: true, user };
}
