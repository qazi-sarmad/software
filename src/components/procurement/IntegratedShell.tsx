import React, { useState } from 'react';
import { AuditDataProvider, useAuditData } from '../../context/AuditDataContext';
import { ThemeProvider } from '../../context/ThemeContext';
const button = 'rounded-lg border border-hairline bg-surface px-3 py-2 text-primary disabled:opacity-50';

function LoginGate({ children }: { children: React.ReactNode }) {
  const store = useAuditData();
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  if (!store.ready) return <main className="p-8">Checking session…</main>;
  if (!store.userId) {
    return (
      <main className="max-w-lg mx-auto p-8 space-y-4">
        <h1 className="font-serif-title text-apple-28">Provio</h1>
        <p>Sign in to your assigned audit scope.</p>
        {(error || store.error) && <p role="alert">{error || store.error}</p>}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setError(''); setSigningIn(true); store.signIn(String(f.get('email')), String(f.get('password'))).catch((x) => setError(x.message)).finally(() => setSigningIn(false)); }}>
          <label className="block">Email<input type="email" autoComplete="username" name="email" required className="block w-full p-2 bg-surface border border-hairline rounded-lg" /></label>
          <label className="block">Password<input type="password" autoComplete="current-password" name="password" required className="block w-full p-2 bg-surface border border-hairline rounded-lg" /></label>
          <button className={button} disabled={signingIn}>Sign in</button>
        </form>
        <p className="text-secondary">Membership and entity assignments are provisioned by your operator. Authentication errors never load demo data.</p>
      </main>
    );
  }
  return <>{children}</>;
}

/** Live (Supabase) wrapper around the full application: theme + data + login gate. */
export default function IntegratedShell({ children }: { children: React.ReactNode }) {
  return <ThemeProvider><AuditDataProvider><LoginGate>{children}</LoginGate></AuditDataProvider></ThemeProvider>;
}
