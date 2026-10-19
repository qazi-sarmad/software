/**
 * Email sender profiles data module (F6, S2).
 *
 * Reads the profiles a caller may see (its own plus the platform default), saves one, records a test
 * result, and sets the platform default. A secret value is never part of this module: the caller
 * passes an already-created secret id, and the UI only ever shows the masked display the server
 * returns (F5).
 */
import { callRpc, getClient, type DataResult } from './db';
import type { ProviderKind } from '../../supabase/functions/_shared/emailAdapters';

const NOT_CONFIGURED = 'The email sender module is not configured.';

export interface SenderProfile {
  id: string;
  orgId: string | null;
  scope: 'platform' | 'tenant';
  provider: ProviderKind;
  displayName: string | null;
  fromAddress: string | null;
  replyTo: string | null;
  enabled: boolean;
  isDefault: boolean;
  forced: boolean;
  allowTenantProfile: boolean;
  fallbackToPlatform: boolean;
  dailyCap: number | null;
  status: 'untested' | 'ok' | 'failing';
  lastTestAt: string | null;
  lastTestResult: string | null;
  credentialSecretId: string | null;
  credentialDisplay: string | null;
}

interface RawProfile {
  id: string;
  org_id: string | null;
  scope: 'platform' | 'tenant';
  provider: ProviderKind;
  display_name: string | null;
  from_address: string | null;
  reply_to: string | null;
  enabled: boolean;
  is_default: boolean;
  forced: boolean;
  allow_tenant_profile: boolean;
  fallback_to_platform: boolean;
  daily_cap: number | null;
  status: 'untested' | 'ok' | 'failing';
  last_test_at: string | null;
  last_test_result: string | null;
  credential_secret_id: string | null;
  credential_display: string | null;
}

export async function listSenderProfiles(orgId: string): Promise<SenderProfile[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('email_sender_profiles_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawProfile[]).map((p) => ({
    id: p.id,
    orgId: p.org_id,
    scope: p.scope,
    provider: p.provider,
    displayName: p.display_name,
    fromAddress: p.from_address,
    replyTo: p.reply_to,
    enabled: p.enabled,
    isDefault: p.is_default,
    forced: p.forced,
    allowTenantProfile: p.allow_tenant_profile,
    fallbackToPlatform: p.fallback_to_platform,
    dailyCap: p.daily_cap,
    status: p.status,
    lastTestAt: p.last_test_at,
    lastTestResult: p.last_test_result,
    credentialSecretId: p.credential_secret_id,
    credentialDisplay: p.credential_display,
  }));
}

export function saveSenderProfile(
  orgId: string | null, scope: 'platform' | 'tenant', provider: ProviderKind,
  displayName: string, fromAddress: string, replyTo: string | null,
  providerConfig: Record<string, unknown>, enabled: boolean, dailyCap: number | null
): Promise<DataResult> {
  return callRpc('email_profile_save', {
    p_org: orgId, p_scope: scope, p_provider: provider, p_display_name: displayName,
    p_from_address: fromAddress, p_reply_to: replyTo, p_provider_config: providerConfig,
    p_enabled: enabled, p_daily_cap: dailyCap,
  }, NOT_CONFIGURED);
}

export function setDefaultProfile(profileId: string): Promise<DataResult> {
  return callRpc('email_set_default_profile', { p_id: profileId }, NOT_CONFIGURED);
}

export function forceProfile(
  orgId: string, profileId: string | null, allowTenant: boolean, fallback: boolean
): Promise<DataResult> {
  return callRpc('email_force_profile', {
    p_org: orgId, p_profile_id: profileId, p_allow_tenant: allowTenant, p_fallback: fallback,
  }, NOT_CONFIGURED);
}

/** Record the result of a Test button press. The provider's answer is shown verbatim (F6). */
export function recordTestResult(
  profileId: string, result: string, status: 'untested' | 'ok' | 'failing'
): Promise<DataResult> {
  return callRpc('email_profile_test_result', {
    p_id: profileId, p_result: result, p_status: status,
  }, NOT_CONFIGURED);
}

/** The "set / not set / last tested" line the UI shows instead of any credential (F5). */
export function credentialLine(profile: SenderProfile): string {
  if (!profile.credentialSecretId) return 'Not set';
  return profile.credentialDisplay ?? 'Set';
}

/** The status chip text for a profile. */
export function statusLabel(profile: SenderProfile): string {
  switch (profile.status) {
    case 'ok':
      return 'Working';
    case 'failing':
      return 'Failing';
    default:
      return 'Not tested';
  }
}

export const PROVIDER_LABELS: { value: ProviderKind; label: string }[] = [
  { value: 'stub', label: 'Stub (queue only, nothing sent)' },
  { value: 'resend', label: 'Resend' },
  { value: 'graph_delegated', label: 'Microsoft (one user signs in)' },
  { value: 'graph_app', label: 'Microsoft (app permission)' },
  { value: 'smtp', label: 'Your own mail server (SMTP)' },
];