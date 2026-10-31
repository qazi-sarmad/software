import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { getOrgSecurityStatus, setRequireMfa, listOrgSecurityVersions, type OrgSecurityStatus, type OrgSecurityVersionRow } from '../../data/orgSecurity';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Shield, Check } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Organisation multi-factor policy (0103, OA security tab).
 *
 * A Level-1/Level-2 admin with edit_config requires a second factor for every member. The database
 * enforces edit_config and a reason; the access-token hook withholds the org claims from a session
 * that has not completed a factor, so RLS shows that session no tenant data. Not a blocking modal.
 */
export const MfaPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<OrgSecurityStatus | null>(null);
  const [versions, setVersions] = useState<OrgSecurityVersionRow[]>([]);
  const [required, setRequired] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [s, v] = await Promise.all([getOrgSecurityStatus(), listOrgSecurityVersions()]);
      setStatus(s);
      setVersions(v);
      setRequired(Boolean(s?.requireMfa));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the multi-factor policy.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setResult(null);
    setBusy(true);
    const r = await setRequireMfa(required, reason.trim());
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setReason('');
      await load();
    }
  };

  if (state === 'loading') {
    return <div className="text-apple-13 text-secondary" data-testid="mfa-panel-loading">Loading multi-factor policy…</div>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="mfa-panel-error" />;
  }

  return (
    <div className="space-y-5" data-testid="mfa-panel">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-accent" />
        <h2 className="text-apple-17 font-semibold text-primary">Multi-factor authentication</h2>
      </div>
      <p className="text-apple-13 text-secondary">
        Require a second factor for every member. When enforcement is on, a password-only session
        carries no organisation claim and sees no tenant data: only a session that has completed a
        factor can read the workspace.
      </p>

      <div className="rounded-2xl bg-surface border border-hairline p-4 space-y-3" data-testid="mfa-current">
        <div className="text-apple-12 text-secondary">Current policy</div>
        <div className="text-apple-13 text-primary">
          {status?.requireMfa ? 'Required for every member' : 'Not required'}
          {status ? ` · this session: ${status.aal}${status.mfaSatisfied ? '' : ' (not satisfied)'}` : ''}
        </div>
      </div>

      {!canEdit && (
        <p className="text-apple-12 text-secondary" data-testid="mfa-readonly">
          You need edit_config to change the multi-factor policy. It is shown read-only.
        </p>
      )}

      <div className="space-y-3" data-testid="mfa-form">
        <label className="inline-flex items-center gap-2 text-apple-13 text-primary">
          <input
            type="checkbox"
            data-testid="mfa-required"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            disabled={!canEdit}
          />
          Require a second factor for every member
        </label>
        <label className="block space-y-1">
          <span className="text-apple-12 font-medium text-primary">Reason (required)</span>
          <input
            data-testid="mfa-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canEdit}
            className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
          />
        </label>
        <InlineError message={result && !result.ok ? result.reason : null} testId="mfa-save-error" />
        {result?.ok && (
          <div className="flex items-center gap-2 text-apple-12 text-primary" data-testid="mfa-saved">
            <Check className="w-4 h-4 text-accent" /> Saved.
          </div>
        )}
        <button
          type="button"
          data-testid="mfa-save"
          onClick={save}
          disabled={!canEdit || busy || reason.trim() === ''}
          className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save policy'}
        </button>
      </div>

      <div className="space-y-2" data-testid="mfa-history">
        <div className="text-apple-12 text-secondary">Change history</div>
        {versions.length === 0 && (
          <div className="text-apple-12 text-tertiary" data-testid="mfa-history-empty">No changes yet.</div>
        )}
        {versions.map((v) => (
          <div key={v.rowHash} className="text-apple-12 text-secondary flex items-center justify-between gap-3 border-b border-hairline py-1.5">
            <span>{v.requireMfa ? 'Required' : 'Not required'} · {v.reason}</span>
            <span className="text-tertiary font-mono">{v.rowHash.slice(0, 10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
