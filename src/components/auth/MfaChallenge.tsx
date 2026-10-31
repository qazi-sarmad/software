import React, { useCallback, useEffect, useState } from 'react';
import { InlineError } from '../common/InlineError';
import { Shield } from '../common/Icons';
import { enrollTotp, listMfaFactors, verifyTotp, type MfaFactor } from '../../data/mfa';
import { PRODUCT_NAME } from '../../lib/product';

/**
 * Platform multi-factor authentication (WP9, spec §24).
 *
 * A full-page, data-free screen shown inside the platform gate when the platform requires a second
 * factor and the session has not completed one. It renders no tenant data and reads no tenant table.
 * Not a blocking modal (spec §27.5).
 *
 * Two states:
 *   - enrol: the platform admin has no verified factor yet. The QR and the base32 secret come from
 *     Supabase Auth; the secret is shown once for manual entry, and is never stored by the app.
 *   - challenge: a factor exists; the admin enters the six-digit code to raise the session to AAL2.
 */
export const MfaChallenge: React.FC<{ onSatisfied: () => void; title?: string; friendlyName?: string }> = ({
  onSatisfied, title = 'Platform verification', friendlyName = `${PRODUCT_NAME} platform console`,
}) => {
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [enrolment, setEnrolment] = useState<{ factorId: string; qrCodeSvg: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFactors(await listMfaFactors());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the factors.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verified = factors.filter((f) => f.status === 'verified');

  const startEnrol = async () => {
    setError(null);
    setBusy(true);
    try {
      const e = await enrollTotp(friendlyName);
      setEnrolment({ factorId: e.factorId, qrCodeSvg: e.qrCodeSvg, secret: e.secret });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start enrolment.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (factorId: string) => {
    setError(null);
    setBusy(true);
    try {
      await verifyTotp(factorId, code.trim());
      onSatisfied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const qr = enrolment?.qrCodeSvg ?? '';
  const qrIsDataUri = qr.startsWith('data:');

  return (
    <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6" data-testid="mfa-challenge">
      <div className="w-full max-w-md space-y-5 p-8 rounded-2xl bg-surface border border-hairline">
        <div className="flex items-center gap-2 text-accent">
          <Shield className="w-5 h-5" />
          <h1 className="text-apple-20 font-bold">{title}</h1>
        </div>
        <p className="text-apple-13 text-secondary">
          {enrolment || verified.length === 0
            ? 'Set up an authenticator app. Scan the code, then enter the six-digit number it shows.'
            : 'Enter the six-digit code from your authenticator app to continue.'}
        </p>

        {!enrolment && verified.length === 0 && (
          <button
            type="button"
            data-testid="mfa-enroll"
            onClick={startEnrol}
            disabled={busy}
            className="w-full px-4 py-2.5 rounded-xl bg-accent text-white font-medium text-apple-13 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Begin enrolment
          </button>
        )}

        {enrolment && (
          <div className="space-y-3" data-testid="mfa-enrolment">
            {qrIsDataUri ? (
              <img src={qr} alt="Authenticator QR code" className="w-44 h-44 bg-white p-2 rounded-xl border border-hairline" />
            ) : (
              <div className="w-44 h-44 bg-white p-2 rounded-xl border border-hairline [&>svg]:w-full [&>svg]:h-full"
                dangerouslySetInnerHTML={{ __html: qr }} />
            )}
            <div className="text-apple-12 text-secondary">
              Or enter this key manually:{' '}
              <code data-testid="mfa-secret" className="font-mono text-primary break-all">{enrolment.secret}</code>
            </div>
          </div>
        )}

        {(enrolment || verified.length > 0) && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void verify(enrolment?.factorId ?? verified[0].id);
            }}
          >
            <label className="block space-y-1">
              <span className="text-apple-12 font-medium text-primary">Six-digit code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                data-testid="mfa-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-15 tracking-[0.4em] text-primary outline-none"
              />
            </label>
            <InlineError message={error} testId="mfa-error" />
            <button
              type="submit"
              data-testid="mfa-verify"
              disabled={busy || code.trim().length < 6}
              className="w-full px-4 py-2.5 rounded-xl bg-accent text-white font-medium text-apple-13 hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Verify
            </button>
          </form>
        )}

        {!enrolment && verified.length === 0 && <InlineError message={error} testId="mfa-error" />}
      </div>
    </div>
  );
};
