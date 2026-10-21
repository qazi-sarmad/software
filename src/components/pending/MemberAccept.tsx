import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { acceptMemberInvite, createInviteeAccount } from '../../data/admin';
import { InlineError } from '../common/InlineError';
import { ShieldCheck, CheckCircle } from '../common/Icons';

type Phase = 'idle' | 'busy' | 'done' | 'error';

/**
 * OA-20 (accept): the invitation acceptance screen for a colleague (S3, C2.4).
 *
 * The invitation email links to /invite/accept?token=… and this screen sits OUTSIDE the tenant shell,
 * like /external/accept, because the invitee has no account yet. The invitee sets their own password
 * here (no Supabase Auth email is used), then the token is presented to the invite-user Edge Function,
 * which binds the account to the invited role through admin_accept_invite (service-role only).
 *
 * The screen is honest about the owner's Supabase Auth settings: if sign-ups are disabled it says so
 * plainly, exactly as the external auditor acceptance page does. The invitation is "queued", never
 * "sent", until the dispatcher reports otherwise (D20).
 */
export const MemberAccept: React.FC<{ tokenFromUrl: string }> = ({ tokenFromUrl }) => {
  const { user, status, refreshSession } = useAuth();
  const [token, setToken] = useState(tokenFromUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => { setToken(tokenFromUrl); }, [tokenFromUrl]);

  const accept = useCallback(async () => {
    setPhase('busy');
    setMessage('');
    const r = await acceptMemberInvite(token.trim());
    if (r.ok) {
      // The membership exists now, so re-resolve the session before sending the invitee on.
      await refreshSession();
      setPhase('done');
      return;
    }
    setPhase('error');
    setMessage(r.reason);
  }, [token, refreshSession]);

  /** Create the account, then accept with the token, in one step (the invitee's own password). */
  const createAndAccept = useCallback(async () => {
    if (!token.trim()) {
      setPhase('error');
      setMessage('This link is missing its invitation code. Ask for a new invitation.');
      return;
    }
    if (!email.includes('@')) {
      setPhase('error');
      setMessage('Enter the email address the invitation was sent to.');
      return;
    }
    if (password.length < 8) {
      setPhase('error');
      setMessage('Choose a password of at least eight characters.');
      return;
    }
    setPhase('busy');
    setMessage('');
    const created = await createInviteeAccount(email.trim(), password);
    if (!created.ok) {
      setPhase('error');
      setMessage(created.reason);
      return;
    }
    if (!created.sessionStarted) {
      // The project requires email confirmation: the account exists but there is no session, so the
      // invitation cannot be applied yet. Say so plainly instead of pretending it worked.
      setPhase('error');
      setMessage('Your account was created. Confirm the email your platform sent you, then reopen this invitation link to finish.');
      return;
    }
    await accept();
  }, [token, email, password, accept]);

  const signedIn = status === 'signed_in';

  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-hairline bg-surface p-6 space-y-4" data-testid="oa-accept">
        <header className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-accent" />
          <h1 className="text-apple-16 font-semibold">Accept your invitation</h1>
        </header>

        {phase === 'done' ? (
          <div className="space-y-2" data-testid="oa-accept-done">
            <p className="flex items-center gap-2 text-accent text-apple-13">
              <CheckCircle className="w-4 h-4 stroke-[1.5]" /> Your membership is active.
            </p>
            <a href="/" className="inline-block px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12" data-testid="oa-accept-continue">
              Open your workspace
            </a>
          </div>
        ) : (
          <>
            <p className="text-apple-13 text-secondary">
              {signedIn
                ? 'You are signed in. Confirm the invitation code below to join the organisation.'
                : 'Set your password to create your account, then the invitation is applied. If you already have an account, sign in first and return to this link.'}
            </p>
            <label className="block text-apple-12 text-secondary" htmlFor="oa-accept-token">
              Invitation code
            </label>
            <input
              id="oa-accept-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="oa-accept-token"
              className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-13"
              placeholder="Paste the code from your invitation"
            />
            {!signedIn && (
              <>
                <label className="block text-apple-12 text-secondary" htmlFor="oa-accept-email">Email</label>
                <input
                  id="oa-accept-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="oa-accept-email"
                  className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-13"
                  placeholder="The address the invitation was sent to"
                />
                <label className="block text-apple-12 text-secondary" htmlFor="oa-accept-password">Choose a password</label>
                <input
                  id="oa-accept-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="oa-accept-password"
                  className="w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-13"
                  placeholder="At least eight characters"
                />
              </>
            )}
            <button
              type="button"
              disabled={phase === 'busy'}
              onClick={() => void (signedIn ? accept() : createAndAccept())}
              data-testid="oa-accept-submit"
              className="px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-12 disabled:opacity-50"
            >
              {phase === 'busy' ? 'Checking…' : signedIn ? 'Accept invitation' : 'Create account and accept'}
            </button>
            {phase === 'error' && <InlineError message={message} testId="oa-accept-error" />}
            <p className="text-apple-11 text-tertiary" data-testid="oa-accept-hint">
              Your invitation stays valid for seven days and can be used once. If you were not
              expecting it, you can ignore it.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
