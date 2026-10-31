import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MfaChallenge } from './MfaChallenge';

/**
 * Rendered when a session exists but the organisation's security policy has withheld its tenant
 * claims (0100 SSO, 0103 second factor). The database is the enforcement point: RLS shows this
 * member nothing until the policy is satisfied. This screen is the honest UI for that state.
 *
 *   * `mfa_required` — the organisation requires a second factor. The member completes the challenge
 *     here; on success the token is re-minted with the org claims and the shell resolves normally.
 *   * `sso_required` — the organisation requires single sign-on. There is nothing to do in-app; the
 *     member must sign in through the organisation's identity provider.
 */
export const WithheldScreen: React.FC = () => {
  const { withheld, refreshSession, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    await refreshSession();
    setBusy(false);
  };

  if (withheld === 'mfa_required') {
    return <MfaChallenge onSatisfied={() => void retry()} title="Verify your identity" />;
  }

  return (
    <div
      className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6"
      data-testid="withheld-screen"
    >
      <div className="w-full max-w-md space-y-5 p-8 rounded-2xl bg-surface border border-hairline">
        <div>
          <h1 className="text-apple-28 font-bold tracking-tight">Single sign-on required</h1>
          <p className="text-apple-13 text-secondary mt-2">
            Your organisation requires you to sign in with your company identity provider. Password
            sign-in does not grant access to organisation data.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void retry()}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-accent text-canvas text-apple-13 font-medium disabled:opacity-50"
            data-testid="withheld-retry"
          >
            {busy ? 'Checking…' : 'I signed in with SSO'}
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="px-4 py-2 rounded-xl border border-hairline text-apple-13 text-secondary"
            data-testid="withheld-signout"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
