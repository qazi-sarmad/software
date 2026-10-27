import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Role, User } from '../types';
import { decodeJwtPayload } from '../lib/claims';

export type SignInOutcome = { ok: true } | { ok: false; reason: string };

const ROLE_SLUGS: readonly string[] = ['cia', 'audit_manager', 'reviewer', 'preparer', 'observer', 'org_admin', 'auditee'];

/** Two-letter avatar: first character of the first two words, uppercased. */
export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

function config(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

let client: SupabaseClient | null = null;

/** Only the publishable key is used here. The secret key is never referenced in src/. */
export function getClient(): SupabaseClient | null {
  const c = config();
  if (!c) return null;
  if (!client) client = createClient(c.url, c.key);
  return client;
}

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'Sign-in is not configured.' };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/**
 * Create the account an invitation is waiting for (S3, C2.4). The invitee sets their own password;
 * no Supabase Auth email is used, because the acceptance link in the queued message is the only
 * thing the invitee needs. When the owner has sign-ups disabled the call fails and the caller shows
 * the plain message (the same honesty rule as the external auditor acceptance, F13).
 *
 * `sessionStarted` is false when the project requires email confirmation: the account exists but no
 * session does, so the caller must tell the invitee to confirm and reopen the link rather than
 * pretend the invitation was applied.
 */
export async function signUp(
  email: string, password: string
): Promise<{ ok: true; sessionStarted: boolean } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: 'Account creation is not configured.' };
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, sessionStarted: data.session !== null };
}

export async function signOut(): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  await sb.auth.signOut();
}

/**
 * Mint a fresh access token from the stored refresh token (S3, C2.4).
 *
 * The organisation and role live in the JWT, stamped by the access-token hook (0010). A session
 * minted before a membership change keeps the OLD claims: `org_members` RLS requires
 * `org_id = jwt_org_id()`, so a colleague who has just accepted an invitation cannot see their own
 * membership row until the token is re-minted. Re-reading the session is not enough; the token
 * itself must be replaced. Returns false when there is no session or the refresh failed.
 */
export async function refreshAuthToken(): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.auth.refreshSession();
  return !error && data.session !== null;
}

/** The decoded claims of the current session's access token, or null when there is no session. */
export async function sessionClaims(): Promise<Record<string, unknown> | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return decodeJwtPayload(data.session?.access_token ?? null);
}

export async function loadCurrentUser(): Promise<User | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  if (!session) return null;
  const authUser = session.user;

  const { data: member, error: memberErr } = await sb
    .from('org_members')
    .select('org_id, display_name, roles(slug, rights)')
    .eq('user_id', authUser.id)
    .maybeSingle();
  if (memberErr) throw new Error(memberErr.message);
  if (!member) throw new Error('This account is not provisioned in an organisation.');

  const roleRow = member.roles as unknown as { slug: string; rights: Record<string, boolean> | null } | null;
  const slug: string = roleRow?.slug ?? '';
  if (!ROLE_SLUGS.includes(slug)) throw new Error('Unknown role slug: ' + slug);

  const { data: scopes, error: scopeErr } = await sb
    .from('user_scopes')
    .select('universe_id, entity_id')
    .eq('user_id', authUser.id)
    .eq('org_id', member.org_id);
  if (scopeErr) throw new Error(scopeErr.message);

  const universeIds = [...new Set((scopes ?? []).map((s) => s.universe_id as string | null).filter((x): x is string => !!x))];
  const entityIds = [...new Set((scopes ?? []).map((s) => s.entity_id as string | null).filter((x): x is string => !!x))];

  return {
    id: authUser.id,
    name: member.display_name as string,
    email: authUser.email ?? '',
    avatar: initials(member.display_name as string),
    role: slug as Role,
    rights: roleRow?.rights ?? undefined,
    universeIds,
    entityIds,
    orgId: member.org_id as string,
  };
}
