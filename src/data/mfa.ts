import { getClient } from './client';
import { normaliseAssuranceLevel, type AssuranceLevel } from '../lib/mfa';

/**
 * Multi-factor authentication data module (WP9). The only place the app touches Supabase Auth MFA.
 * Rule M8: the Supabase client lives in src/data/client.ts; this module imports it, a component
 * never does.
 *
 * The platform console requires a TOTP factor. Nothing here generates a secret: Supabase Auth mints
 * it and this module passes the enrolment URI to the UI, which renders a QR code locally.
 */

export type MfaFactor = { id: string; friendlyName: string | null; status: string; createdAt: string };

export type TotpEnrolment = { factorId: string; qrCodeSvg: string; secret: string; uri: string };

export async function listMfaFactors(): Promise<MfaFactor[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return (data?.totp ?? []).map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status,
    createdAt: f.created_at,
  }));
}

/** The session's current assurance level, read from the client. */
export async function currentAssuranceLevel(): Promise<AssuranceLevel> {
  const sb = getClient();
  if (!sb) return 'aal1';
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return 'aal1';
  return normaliseAssuranceLevel(data?.currentLevel);
}

/** Begin TOTP enrolment. Returns the otpauth URI and the base32 secret for the authenticator app. */
export async function enrollTotp(friendlyName: string): Promise<TotpEnrolment> {
  const sb = getClient();
  if (!sb) throw new Error('Multi-factor authentication is not configured.');
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error) throw new Error(error.message);
  return {
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/** Challenge and verify a code for a factor. On success the session becomes AAL2. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const sb = getClient();
  if (!sb) throw new Error('Multi-factor authentication is not configured.');
  const { data: challenge, error: challengeError } = await sb.auth.mfa.challenge({ factorId });
  if (challengeError) throw new Error(challengeError.message);
  const { error: verifyError } = await sb.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) throw new Error(verifyError.message);
}

export async function unenrollTotp(factorId: string): Promise<void> {
  const sb = getClient();
  if (!sb) throw new Error('Multi-factor authentication is not configured.');
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}
