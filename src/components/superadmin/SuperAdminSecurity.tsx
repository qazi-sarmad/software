import React, { useCallback, useEffect, useState } from 'react';
import {
  getDrSettings, getSecurityStatus, listSigningAlgorithms, logRecoveryTest, rotateSigningKey,
  setDrSetting, setSecuritySetting, signingKeysDue,
  type DrSettings, type DueKey, type SecurityStatus, type SigningAlgorithm,
} from '../../data/platform';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Shield, Check, Database, Lock } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Super Admin security console (WP9, WP14, WP16).
 *
 * The platform security posture in one place: the second-factor switch and the unlisted console
 * path; the backup/PITR/DR record; and the signing-algorithm registry with the keys due for
 * rotation. Every change is a reason-stamped, ledgered platform RPC that the database gates on the
 * platform role and AAL2. Not a blocking modal.
 */
export const SuperAdminSecurity: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [dr, setDr] = useState<DrSettings | null>(null);
  const [algorithms, setAlgorithms] = useState<SigningAlgorithm[]>([]);
  const [due, setDue] = useState<DueKey[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaReason, setMfaReason] = useState('');
  const [pathValue, setPathValue] = useState('');
  const [pathReason, setPathReason] = useState('');
  const [rotate, setRotate] = useState({ keyId: '', newKeyId: '', publicKey: '', algorithm: 'Ed25519', reason: '' });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [s, d, a] = await Promise.all([getSecurityStatus(), getDrSettings(), listSigningAlgorithms()]);
      setSecurity(s);
      setDr(d);
      setAlgorithms(a);
      setPathValue(s?.adminPath ?? '');
      // The keyring check uses the browser clock: this is UI, not a pure function.
      setDue(await signingKeysDue(new Date().toISOString()).catch(() => []));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the security console.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<DataResult>) => {
    setResult(null);
    setBusy(true);
    const r = await fn();
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <div className="text-apple-13 text-secondary" data-testid="superadmin-security-loading">Loading security console…</div>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="superadmin-security-error" />;
  }

  return (
    <div className="space-y-6" data-testid="superadmin-security">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-security-action-error" />
      {result?.ok && (
        <div className="flex items-center gap-2 text-apple-12 text-primary" data-testid="superadmin-security-action-ok">
          <Check className="w-4 h-4 text-accent" /> Saved.
        </div>
      )}

      {/* --- MFA and the console path --- */}
      <section className="space-y-3" data-testid="superadmin-security-mfa">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-accent" />
          <h2 className="text-apple-17 font-semibold text-primary">Platform access</h2>
        </div>
        <div className="text-apple-13 text-secondary">
          Session level: <span className="text-primary font-medium">{security?.aal ?? 'aal1'}</span>
          {security?.requirePlatformMfa ? ' · second factor required' : ' · second factor optional'}
        </div>
        <div className="space-y-2 rounded-2xl bg-surface border border-hairline p-4" data-testid="superadmin-security-mfa-box">
          <div className="text-apple-13 text-primary">
            {security?.requirePlatformMfa
              ? 'Every platform action requires a verified second factor.'
              : 'A password session may act on the platform. Turn this on after you have enrolled an authenticator.'}
          </div>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Reason (required)</span>
            <input
              data-testid="superadmin-security-mfa-reason"
              value={mfaReason}
              onChange={(e) => setMfaReason(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            />
          </label>
          <button
            type="button"
            data-testid="superadmin-security-mfa-toggle"
            disabled={busy || mfaReason.trim() === ''}
            onClick={() => run(() => setSecuritySetting('require_platform_mfa', !security?.requirePlatformMfa, mfaReason.trim()))}
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {security?.requirePlatformMfa ? 'Turn the second factor off' : 'Require the second factor'}
          </button>
        </div>

        <div className="space-y-2 rounded-2xl bg-surface border border-hairline p-4" data-testid="superadmin-security-path-box">
          <div className="text-apple-12 text-secondary">Unlisted console path (VITE_PLATFORM_ADMIN_PATH)</div>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Path</span>
            <input
              data-testid="superadmin-security-path"
              value={pathValue}
              onChange={(e) => setPathValue(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 font-mono text-primary outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Reason (required)</span>
            <input
              data-testid="superadmin-security-path-reason"
              value={pathReason}
              onChange={(e) => setPathReason(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            />
          </label>
          <button
            type="button"
            data-testid="superadmin-security-path-save"
            disabled={busy || pathReason.trim() === '' || pathValue.trim() === ''}
            onClick={() => run(() => setSecuritySetting('admin_path', pathValue.trim(), pathReason.trim()))}
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Save path
          </button>
          <p className="text-apple-11 text-secondary">
            The path is a deterrent, not the control. The control is the platform role and the second
            factor. Set VITE_PLATFORM_ADMIN_PATH at deploy time to match.
          </p>
        </div>
      </section>

      {/* --- Backup / PITR / DR --- */}
      <section className="space-y-3" data-testid="superadmin-security-dr">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-accent" />
          <h2 className="text-apple-17 font-semibold text-primary">Backup and recovery</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 text-apple-13">
          <div className="rounded-2xl bg-surface border border-hairline p-3">
            <div className="text-apple-11 text-secondary">PITR</div>
            <div className="text-primary" data-testid="superadmin-security-dr-pitr">{dr?.pitrEnabled ? 'on' : 'off'}</div>
          </div>
          <div className="rounded-2xl bg-surface border border-hairline p-3">
            <div className="text-apple-11 text-secondary">Retention (days)</div>
            <div className="text-primary" data-testid="superadmin-security-dr-retention">{dr?.retentionDays}</div>
          </div>
          <div className="rounded-2xl bg-surface border border-hairline p-3">
            <div className="text-apple-11 text-secondary">RPO / RTO (min)</div>
            <div className="text-primary">{dr?.rpoMinutes} / {dr?.rtoMinutes}</div>
          </div>
          <div className="rounded-2xl bg-surface border border-hairline p-3">
            <div className="text-apple-11 text-secondary">Next restore test due</div>
            <div className="text-primary" data-testid="superadmin-security-dr-next">{dr?.nextRecoveryTestDue ? dr.nextRecoveryTestDue.slice(0, 10) : 'not yet tested'}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="superadmin-security-dr-pitr-toggle"
            disabled={busy}
            onClick={() => run(() => setDrSetting('pitr_enabled', !dr?.pitrEnabled, 'DR posture change'))}
            className="px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary transition-colors disabled:opacity-50"
          >
            {dr?.pitrEnabled ? 'Record PITR off' : 'Record PITR on'}
          </button>
          <button
            type="button"
            data-testid="superadmin-security-dr-recovery-test"
            disabled={busy}
            onClick={() => run(() => logRecoveryTest('restore test recorded from the console', new Date().toISOString()))}
            className="px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Record a restore test
          </button>
        </div>
      </section>

      {/* --- Crypto agility --- */}
      <section className="space-y-3" data-testid="superadmin-security-crypto">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-accent" />
          <h2 className="text-apple-17 font-semibold text-primary">Signing algorithms and rotation</h2>
        </div>
        <ul className="space-y-1" data-testid="superadmin-security-algorithms">
          {algorithms.map((a) => (
            <li key={a.code} className="flex items-center justify-between text-apple-13 rounded-xl bg-surface border border-hairline px-3 py-2" data-testid={`superadmin-security-algorithm-${a.code}`}>
              <span className="text-primary">{a.label}</span>
              <span className="text-apple-11 text-secondary">{a.status}{a.isDefault ? ' · default' : ''} · rotate every {a.rotationDays}d</span>
            </li>
          ))}
        </ul>
        <div className="text-apple-12 text-secondary" data-testid="superadmin-security-due">
          {due.length === 0 ? 'No keys are due for rotation.' : `${due.length} key(s) due for rotation.`}
        </div>
        <div className="space-y-2 rounded-2xl bg-surface border border-hairline p-4" data-testid="superadmin-security-rotate-box">
          <div className="text-apple-12 text-secondary">
            Rotation mints a new key version and retires the old key, which keeps verifying historic
            signatures. Key material is generated outside the browser; paste the new public key here.
          </div>
          {(['keyId', 'newKeyId', 'publicKey', 'reason'] as const).map((field) => (
            <label key={field} className="block space-y-1">
              <span className="text-apple-12 font-medium text-primary">{field}</span>
              <input
                data-testid={`superadmin-security-rotate-${field}`}
                value={rotate[field]}
                onChange={(e) => setRotate((r) => ({ ...r, [field]: e.target.value }))}
                className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
              />
            </label>
          ))}
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">algorithm</span>
            <select
              data-testid="superadmin-security-rotate-algorithm"
              value={rotate.algorithm}
              onChange={(e) => setRotate((r) => ({ ...r, algorithm: e.target.value }))}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            >
              {algorithms.filter((a) => a.status === 'active').map((a) => (
                <option key={a.code} value={a.code}>{a.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="superadmin-security-rotate"
            disabled={busy || rotate.keyId.trim() === '' || rotate.newKeyId.trim() === '' || rotate.publicKey.trim() === '' || rotate.reason.trim() === ''}
            onClick={() => run(() => rotateSigningKey(
              rotate.keyId.trim(), rotate.newKeyId.trim(), rotate.publicKey.trim(), rotate.algorithm, rotate.reason.trim(), new Date().toISOString()
            ))}
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Rotate key
          </button>
        </div>
      </section>
    </div>
  );
};
