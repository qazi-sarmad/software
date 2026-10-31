import { callRpc, getClient, type DataResult } from './db';

/**
 * SSO data module (WP11). Components never import the Supabase client.
 *
 * The actual federated sign-in is Supabase Auth's `signInWithSSO({ domain })`: Supabase resolves the
 * domain to the configured SAML/OIDC provider and runs the handshake. Provio stores the policy
 * (which provider, which domain, enforced) and the access-token hook enforces it. No anonymous
 * lookup is added: the domain→org mapping is a diagnostic RPC for a signed-in admin, not a
 * pre-auth surface.
 */

export interface SsoProvider {
  provider: string;
  label: string;
  protocol: 'saml' | 'oidc';
}

export interface SsoSettings {
  provider: string | null;
  domain: string | null;
  enforced: boolean;
  setAt: string | null;
  reason: string | null;
}

export async function listSsoProviders(): Promise<SsoProvider[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('sso_providers')
    .select('provider, label, protocol')
    .eq('enabled', true)
    .order('label');
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    provider: p.provider as string,
    label: (p.label as string) ?? (p.provider as string),
    protocol: (p.protocol as 'saml' | 'oidc') ?? 'saml',
  }));
}

export async function getSsoSettings(orgId: string): Promise<SsoSettings | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sso_get_settings', { p_org: orgId });
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) return { provider: null, domain: null, enforced: false, setAt: null, reason: null };
  return {
    provider: (r.provider as string | null) ?? null,
    domain: (r.domain as string | null) ?? null,
    enforced: Boolean(r.enforced),
    setAt: (r.set_at as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
  };
}

/** Set the org SSO policy. The database requires edit_config and a reason. */
export function setSsoProvider(
  orgId: string,
  provider: string | null,
  domain: string | null,
  enforced: boolean,
  reason: string
): Promise<DataResult> {
  return callRpc(
    'sso_set_provider',
    { p_org: orgId, p_provider: provider, p_domain: domain, p_enforced: enforced, p_reason: reason },
    'The SSO module is not configured.'
  );
}

/** The org that owns an email domain. Diagnostic for a signed-in admin; never a pre-auth lookup. */
export async function ssoOrgForDomain(domain: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('sso_org_for_domain', { p_domain: domain });
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  return (r?.org_id as string | null) ?? null;
}

/** Start a federated sign-in for a work-email domain. Supabase Auth resolves the provider. */
export async function signInWithSso(domain: string): Promise<DataResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'SSO is not configured.' };
  const { error } = await sb.auth.signInWithSSO({ domain: domain.trim().toLowerCase() });
  return error ? { ok: false, reason: error.message } : { ok: true };
}
