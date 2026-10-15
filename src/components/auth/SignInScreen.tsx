import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { InlineError } from '../common/InlineError';

/** Shown whenever there is no authenticated session. It renders no application data. */
export const SignInScreen: React.FC = () => {
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signInWithPassword(email.trim(), password);
    setBusy(false);
    if (!result.ok) setError(result.reason);
  };

  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6" data-testid="signin-screen">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-2xl bg-surface border border-hairline">
        <div>
          <h1 className="text-apple-28 font-bold tracking-tight">Provio</h1>
          <p className="text-apple-13 text-secondary mt-1">Sign in to your organisation workspace.</p>
        </div>
        <form onSubmit={submit} className="space-y-4" data-testid="signin-form">
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none" />
          </label>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none" />
          </label>
          <InlineError message={error} testId="signin-error" />
          <button type="submit" disabled={busy}
            className="w-full px-4 py-2.5 rounded-xl bg-accent text-white font-medium text-apple-13 hover:opacity-90 transition-opacity disabled:opacity-50">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
};
