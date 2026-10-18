import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

/**
 * Rendered when a session exists but the account is not yet a member of any organisation (D4).
 * Without it a freshly created account sat on the loading spinner indefinitely. It offers a Refresh
 * that re-resolves the session, so an administrator adding the account need not sign out and in.
 */
export const NoTenantScreen: React.FC = () => {
  const { refreshSession, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    await refreshSession();
    setBusy(false);
  };

  return (
    <div
      className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6"
      data-testid="no-tenant-screen"
    >
      <div className="w-full max-w-md space-y-5 p-8 rounded-2xl bg-surface border border-hairline">
        <div>
          <h1 className="text-apple-28 font-bold tracking-tight">Welcome to Provio</h1>
          <p className="text-apple-13 text-secondary mt-2">
            Your account has been created, but you are not yet assigned to an organisation. Your
            administrator will add you shortly. Check back in a few moments, or contact support.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-accent text-canvas text-apple-13 font-medium disabled:opacity-50"
            data-testid="no-tenant-refresh"
          >
            {busy ? 'Checking…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="px-4 py-2 rounded-xl border border-hairline text-apple-13 text-secondary"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
