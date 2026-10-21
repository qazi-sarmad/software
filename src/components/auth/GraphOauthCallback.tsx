import React, { useCallback, useEffect, useState } from 'react';
import { exchangeGraphCode } from '../../data/emailOauth';
import { InlineError } from '../common/InlineError';
import { CheckCircle, Shield } from '../common/Icons';

type Phase = 'idle' | 'busy' | 'done' | 'error';

interface GraphOauthCallbackProps {
  /** The screen id the testids are prefixed with: `oa-11` (Org Admin) or `sa-04` (Super Admin). */
  screenId: string;
}

/**
 * C1.1: the Microsoft Graph sign-in callback.
 *
 * The consent redirect returns `?code=...&state=...`. The state is the signed, single-use token the
 * graph-oauth Edge Function issued in `start`; this screen only forwards the pair. The function
 * verifies the state (user, org, expiry, single use) and stores the refresh token, returning only
 * the secret reference. No token reaches this screen.
 *
 * The route lives outside the tenant shell so it also serves the platform-level flow (SA-04).
 */
export const GraphOauthCallback: React.FC<GraphOauthCallbackProps> = ({ screenId }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  const run = useCallback(async (code: string, state: string) => {
    setPhase('busy');
    setMessage('');
    const r = await exchangeGraphCode(code, state);
    if (r.ok) {
      setPhase('done');
      setMessage(`Connected. The credential is stored as ${r.masked}.`);
      return;
    }
    setPhase('error');
    setMessage(r.reason);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') ?? '';
    const state = params.get('state') ?? '';
    const denied = params.get('error');
    if (denied) {
      setPhase('error');
      setMessage('The sign-in was cancelled or refused. Nothing was stored.');
      return;
    }
    if (!code || !state) {
      setPhase('error');
      setMessage('This page needs the code and state from the sign-in. Start the sign-in again.');
      return;
    }
    void run(code, state);
  }, [run]);

  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-hairline bg-surface p-6 space-y-4" data-testid={`${screenId}-oauth-callback`}>
        <header className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent" />
          <h1 className="text-apple-16 font-semibold">Microsoft sign-in</h1>
        </header>

        {phase === 'busy' && (
          <p className="text-apple-13 text-secondary" data-testid={`${screenId}-oauth-busy`}>
            Finishing the sign-in…
          </p>
        )}

        {phase === 'done' && (
          <div className="space-y-2" data-testid={`${screenId}-oauth-done`}>
            <p className="flex items-center gap-2 text-accent text-apple-13">
              <CheckCircle className="w-4 h-4 stroke-[1.5]" /> {message}
            </p>
            <a href="/" className="inline-block px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12" data-testid={`${screenId}-oauth-continue`}>
              Return to Provio
            </a>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-2">
            <InlineError message={message} testId={`${screenId}-oauth-error`} />
            <a href="/" className="inline-block text-apple-12 text-accent hover:underline" data-testid={`${screenId}-oauth-back`}>
              Return to Provio
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
