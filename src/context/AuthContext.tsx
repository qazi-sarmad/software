import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { signIn as clientSignIn, signOut as clientSignOut, loadCurrentUser } from '../data/client';

export type SignInResult = { ok: true } | { ok: false; reason: string };

interface AuthContextType {
  /** The authenticated identity, or null when there is no session. There is no default user. */
  user: User | null;
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

  useEffect(() => {
    loadCurrentUser()
      .then((u) => {
        if (u) setUser(u);
      })
      .catch(() => undefined);
  }, []);

  const signInWithPassword = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const result = await clientSignIn(email, password);
    if (!result.ok) return result;
    try {
      const u = await loadCurrentUser();
      if (!u) return { ok: false, reason: 'Sign-in did not create a session.' };
      setUser(u);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Sign-in failed.' };
    }
  }, []);

  const signOut = useCallback(async () => {
    setUser(null);
    await clientSignOut();
  }, []);

  const value = useMemo(() => ({ user, signInWithPassword, signOut }), [user, signInWithPassword, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
