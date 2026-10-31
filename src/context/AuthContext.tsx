import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { signIn as clientSignIn, signOut as clientSignOut, loadCurrentUser, refreshAuthToken, sessionClaims } from '../data/client';
import { isExternalAuditorSession } from '../data/externalAuditors';
import { platformWhoami, getSecurityStatus } from '../data/platform';
import { withheldReason, type WithheldReason } from '../lib/claims';

export type SignInResult = { ok: true } | { ok: false; reason: string };

/**
 * The lifecycle of the session, resolved from the database (D4). The application shell is chosen
 * from this, so a signed-in account that is not yet in an organisation sees a "welcome, not
 * provisioned" screen instead of an indefinite loading state.
 */
export type AuthStatus = 'loading' | 'signed_out' | 'no_tenant' | 'signed_in' | 'platform' | 'external_auditor' | 'withheld';

interface AuthContextType {
  /** The authenticated identity, or null when there is no session. There is no default user. */
  user: User | null;
  /** The resolved session lifecycle. */
  status: AuthStatus;
  /**
   * True when the session belongs to platform staff (spec §24). Platform users are not provisioned
   * in any org, so they have no tenant identity; only the /superadmin route acts on this.
   */
  isPlatform: boolean;
  /**
   * True when the platform requires a second factor (WP9) and this session has not completed one.
   * The platform gate renders the MFA challenge instead of the portal while this is true.
   */
  platformNeedsMfa: boolean;
  /** Re-resolve the platform second-factor requirement after a successful verification. */
  refreshPlatformMfa: () => Promise<void>;
  /**
   * The reason the session's tenant claims were withheld, or null (0100 SSO, 0103 MFA). When set,
   * the shell shows the matching screen instead of the "not provisioned" welcome.
   */
  withheld: WithheldReason | null;
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
  /** Re-resolve the session. The NoTenantScreen uses this so an account added to an org need not sign out. */
  refreshSession: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Holds the session identity in memory. The identity is resolved from the authenticated session
 * through the data module. The rest of the app receives it, and cannot change it.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isPlatform, setIsPlatform] = useState(false);
  const [platformNeedsMfa, setPlatformNeedsMfa] = useState(false);
  const [withheld, setWithheld] = useState<WithheldReason | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  /**
   * Resolve whether the platform requires a second factor this session has not completed (WP9).
   * `platform_security_status` is readable at any AAL, so this tells the gate to show the challenge
   * rather than the portal. Any failure resolves to "not needed", so a transient error never locks
   * an owner out; the database still refuses the RPCs if the factor is genuinely missing.
   */
  const resolvePlatformMfa = useCallback(async () => {
    try {
      const s = await getSecurityStatus();
      setPlatformNeedsMfa(Boolean(s?.requirePlatformMfa) && !Boolean(s?.mfaSatisfied));
    } catch {
      setPlatformNeedsMfa(false);
    }
  }, []);

  // Resolve the session from the database. loadCurrentUser returns null when there is no session
  // (signed out) and throws when there is a session but no org membership. The second case resolves
  // to 'no_tenant' so the shell can offer the welcome screen rather than hang (D4).
  const resolveSession = useCallback(async () => {
    setStatus('loading');
    let outcome: User | null | 'no_member';
    try {
      const u = await loadCurrentUser();
      outcome = u ?? null;
    } catch {
      outcome = 'no_member';
    }
    if (outcome && outcome !== 'no_member') {
      setUser(outcome);
      setIsPlatform(false);
      setWithheld(null);
      setStatus('signed_in');
      return;
    }
    if (outcome === null) {
      setUser(null);
      setIsPlatform(false);
      setWithheld(null);
      setStatus('signed_out');
      return;
    }
    // A session exists but reads no membership: the org may be enforcing SSO or a second factor, in
    // which case the hook withheld the org claims and RLS hid the membership row (0100, 0103). Read
    // the flag from the token so the shell shows the right screen rather than "not provisioned".
    const withheldState = withheldReason(await sessionClaims().catch(() => null));
    if (withheldState) {
      setUser(null);
      setIsPlatform(false);
      setWithheld(withheldState);
      setStatus('withheld');
      return;
    }
    const who = await platformWhoami().catch(() => null);
    if (who?.isPlatformAdmin) {
      setUser(null);
      setIsPlatform(true);
      setStatus('platform');
      await resolvePlatformMfa();
      return;
    }
    // A signed-in account with no org membership may be an external auditor (F13). The database
    // decides through ext_me; only then does the shell show the read-only portal rather than the
    // "not provisioned" screen.
    if (await isExternalAuditorSession().catch(() => false)) {
      setUser(null);
      setIsPlatform(false);
      setStatus('external_auditor');
      return;
    }
    setUser(null);
    setIsPlatform(false);
    setStatus('no_tenant');
  }, []);

  useEffect(() => {
    void resolveSession();
  }, [resolveSession]);

  /**
   * Re-resolve the session after a membership change (S3, C2.4). The org and role claims live in the
   * JWT, so re-reading the session alone would still see the pre-change claims and `org_members` RLS
   * would hide the new membership. Mint a fresh token first, then resolve. The extra call is a no-op
   * when there is no session.
   */
  const refreshSession = useCallback(async () => {
    await refreshAuthToken().catch(() => false);
    await resolveSession();
  }, [resolveSession]);

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const result = await clientSignIn(email, password);
    if (!result.ok) return result;
    try {
      const u = await loadCurrentUser().catch(() => null);
      if (u) {
        setUser(u);
        setIsPlatform(false);
        setWithheld(null);
        setStatus('signed_in');
        return { ok: true };
      }
      // No membership row: the org may enforce SSO or a second factor, so the hook withheld the org
      // claims (0100, 0103). Show the matching screen rather than "not provisioned".
      const withheldState = withheldReason(await sessionClaims().catch(() => null));
      if (withheldState) {
        setUser(null);
        setIsPlatform(false);
        setWithheld(withheldState);
        setStatus('withheld');
        return { ok: true };
      }
      // No org membership: the account may be platform staff (spec §24). The platform RPC decides.
      const who = await platformWhoami();
      if (who.isPlatformAdmin) {
        setIsPlatform(true);
        setWithheld(null);
        setStatus('platform');
        await resolvePlatformMfa();
        return { ok: true };
      }
      // Or an external auditor (F13): the database decides through ext_me, and the shell then shows
      // the read-only portal instead of the "not provisioned" welcome screen.
      if (await isExternalAuditorSession().catch(() => false)) {
        setUser(null);
        setIsPlatform(false);
        setWithheld(null);
        setStatus('external_auditor');
        return { ok: true };
      }
      // Signed in but not provisioned: the app shell shows the welcome screen, not an error.
      setUser(null);
      setIsPlatform(false);
      setWithheld(null);
      setStatus('no_tenant');
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Sign-in failed.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    setIsPlatform(false);
    setPlatformNeedsMfa(false);
    setWithheld(null);
    setStatus('signed_out');
    await clientSignOut();
  }, []);

  const value = useMemo(
    () => ({ user, status, isPlatform, platformNeedsMfa, refreshPlatformMfa: resolvePlatformMfa, withheld, signInWithPassword, refreshSession, signOut }),
    [user, status, isPlatform, platformNeedsMfa, resolvePlatformMfa, withheld, signInWithPassword, refreshSession, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
