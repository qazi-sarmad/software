import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R6c: each synthetic user gets its own random password per run, written by `global-setup.ts` to
 * the git-ignored `e2e/.auth/passwords.json`. Specs read the value for the account they sign in as,
 * so one leaked password does not open every account.
 */
let cache: Record<string, string> | null = null;

export function passwordFor(email: string): string {
  if (!cache) {
    cache = JSON.parse(
      readFileSync(join(process.cwd(), 'e2e/.auth/passwords.json'), 'utf8')
    ) as Record<string, string>;
  }
  return cache[email] ?? '';
}
