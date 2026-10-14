import { initialUsers } from '../data/initialData';
import { demoSeed } from '../data/demoSeed';
import type { Role, User } from '../types';

/**
 * Test-only helper. Components no longer get a default user, so tests state the identity they run as.
 * Users come from the flagged demo tenant seed. This file must never be imported by production code.
 */
export function testUser(role: Role = 'cia'): User {
  const user = initialUsers.find((u) => u.role === role);
  if (!user) throw new Error(`No demo-tenant user with role ${role}`);
  return user;
}

/** Test-only: the demo tenant seed that AppProvider now requires. */
export const testSeed = demoSeed;
