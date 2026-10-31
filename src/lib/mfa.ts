/**
 * Pure multi-factor-authentication decision helpers (WP9).
 *
 * The rule is small and total: a session satisfies the platform gate when the switch is off, or when
 * the session has completed a second factor (Supabase AAL2). It is a pure function of its arguments
 * so it can be tested without a browser, a clock or a network.
 */

export type AssuranceLevel = 'aal1' | 'aal2';

/** True when the platform gate is satisfied for the given requirement and session level. */
export function mfaSatisfied(required: boolean, level: AssuranceLevel): boolean {
  return !required || level === 'aal2';
}

/** Normalise the assurance level a session reports into the closed vocabulary. */
export function normaliseAssuranceLevel(level: string | null | undefined): AssuranceLevel {
  return level === 'aal2' ? 'aal2' : 'aal1';
}
