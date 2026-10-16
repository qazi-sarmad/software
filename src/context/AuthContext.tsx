import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { signIn as clientSignIn, signOut as clientSignOut, loadCurrentUser } from '../data/client';
import { platformWhoami } from '../data/platform';

export type SignInResult = { ok: true } | { ok: false; reason: string };

interface AuthContextType {
  /** The authenticated identity, or null when there is no session. There is no default user. */
  user: User | null;
  /**
   * True when the session belongs to platform staff (spec §24). Platform users are not provisioned
   * in any org, so they have no tenant identity; only the /superadmin route acts on this.
   */
  isPlatform: boolean;
  signInWithPassword: (email: string, password: string) => Promise<SignInResult>;
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

  useEffect(() => {
    // A platform account is not provisioned in any org, so loadCurrentUser throws for it; in that
    // case ask the database whether the session is platform staff (spec §24).
    loadCurrentUser()
      .then((u) => {
        if (u) setUser(u);
      })
      .catch(() => {
        platformWhoami()
          .then((who) => setIsPlatform(who.isPlatformAdmin))
          .catch(() => undefined);
      });
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const result = await clientSignIn(email, password);
    if (!result.ok) return result;
    try {
      const u = await loadCurrentUser().catch(() => null);
      if (u) {
        setUser(u);
        setIsPlatform(false);
        return { ok: true };
      }
      // No org membership: the account may be platform staff (spec §24). The platform RPC decides.
      const who = await platformWhoami();
      if (who.isPlatformAdmin) {
        setIsPlatform(true);
        return { ok: true };
      }
      return { ok: false, reason: 'This account is not provisioned in an organisation.' };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Sign-in failed.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    setIsPlatform(false);
    await clientSignOut();
  }, []);

  const value = useMemo(
    () => ({ user, isPlatform, signInWithPassword, signOut }),
    [user, isPlatform, signInWithPassword, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
