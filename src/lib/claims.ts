/**
 * Pure decoders for the two "withheld" claims the access-token hook stamps (0100, 0103).
 *
 * When an organisation requires SSO, or requires a second factor, the hook withholds `org_id` and
 * `user_role` from the token and sets a flag claim instead. RLS then shows the member nothing. The
 * app reads the flag to show the right screen — an SSO route, or the MFA challenge — rather than the
 * misleading "not provisioned" welcome. This module is pure: it decodes an argument, never a clock or
 * a network.
 */

export type WithheldReason = 'mfa_required' | 'sso_required';

/** Decode a JWT payload without verifying it. Returns null for a malformed token. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The reason the session's tenant claims were withheld, or null when they were not.
 * A present `org_id` means nothing was withheld, whatever flags a stale token carries.
 */
export function withheldReason(payload: Record<string, unknown> | null): WithheldReason | null {
  if (!payload) return null;
  if (typeof payload.org_id === 'string' && payload.org_id !== '') return null;
  if (payload.mfa_required === true) return 'mfa_required';
  if (payload.sso_required === true) return 'sso_required';
  return null;
}
