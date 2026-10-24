import React, { useCallback, useEffect, useState } from 'react';
import { acceptExternalInvite } from '../../data/externalAuditors';
import { SIGNUP_DISABLED_HINT } from '../../lib/externalAuditors';
import { InlineError } from '../common/InlineError';
import { ShieldCheck, CheckCircle } from '../common/Icons';

type Phase = 'idle' | 'busy' | 'done' | 'error';

/**
 * EX-01: accept an external-auditor invitation (F13).
 *
 * The invitation email links to /external/accept?token=... The visitor signs in (or creates the
 * account the owner's Supabase Auth settings allow), then the token is presented to the invite-user
 * Edge Function, which binds the account through external_auditor_accept (service-role only). The
 * screen is honest: if signups are disabled by the owner, it says so plainly.
 */
export const ExternalAuditorAccept: React.FC<{ tokenFromUrl: string }> = ({ tokenFromUrl }) => {
  const [token, setToken] = useState(tokenFromUrl);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => { setToken(tokenFromUrl); }, [tokenFromUrl]);

  const submit = useCallback(async () => {
    if (!token.trim()) { setPhase('error'); setMessage('This link is missing its invitation code. Ask for a new invitation.'); return; }
    setPhase('busy');
    setMessage('');
    const r = await acceptExternalInvite(token.trim());
    if (r.ok) { setPhase('done'); return; }
    setPhase('error');
    setMessage(r.reason);
  }, [token]);

  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-hairline bg-surface p-6 space-y-4" data-testid="ex-accept">
        <header className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <h1 className="text-apple-16 font-semibold">Accept your auditor invitation</h1>
        </header>

        {phase === 'done' ? (
          <div className="space-y-2" data-testid="ex-accept-done">
            <p className="flex items-center gap-2 text-accent text-apple-13">
              <CheckCircle className="w-4 h-4 stroke-[1.5]" /> Your access is now active.
            </p>
            <a href="/external" className="inline-block px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12" data-testid="ex-accept-continue">
              Open the auditor portal
            </a>
          </div>
        ) : (
          <>
            <p className="text-apple-13 text-secondary">
              Sign in first, then confirm the invitation code below. If you do not have an account
              yet, use the link in your invitation email to create one.
            </p>
            <label className="block text-apple-12 text-secondary" htmlFor="ex-accept-token">
              Invitation code
            </label>
            <input
              id="ex-accept-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="ex-accept-token"
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-13"
              placeholder="Paste the code from your invitation"
            />
            <button
              type="button"
              disabled={phase === 'busy'}
              onClick={() => void submit()}
              data-testid="ex-accept-submit"
              className="px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12 disabled:opacity-50"
            >
              {phase === 'busy' ? 'Checking…' : 'Accept invitation'}
            </button>
            {phase === 'error' && <InlineError message={message} testId="ex-accept-error" />}
            <p className="text-apple-11 text-tertiary" data-testid="ex-accept-hint">{SIGNUP_DISABLED_HINT}</p>
          </>
        )}
      </div>
    </div>
  );
};
