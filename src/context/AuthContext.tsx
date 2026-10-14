import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { User } from '../types';

export type SignInResult = { ok: true } | { ok: false; reason: string };

interface AuthContextType {
  /** The authenticated identity, or null when there is no session. There is no default user. */
  user: User | null;
  signIn: (email: string) => Promise<SignInResult>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Holds the session identity in memory only (nothing is persisted, so a reload signs out).
 * Identity is resolved only here, from the sign-in boundary. The rest of the app receives it, and cannot change it.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const signIn = useCallback(async (email: string): Promise<SignInResult> => {
    // The stub is development-only. Production has no way to sign in until real authentication exists.
    if (!import.meta.env.DEV) {
      return { ok: false, reason: 'Sign-in is not available: authentication is not configured in this build.' };
    }
    const { resolveTempAccount } = await import('../lib/tempAuth');
    const result = resolveTempAccount(email);
    if (!result.ok) return result;
    setUser(result.user);
    return { ok: true };
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
