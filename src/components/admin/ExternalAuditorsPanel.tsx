import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  inviteExternalAuditor,
  listExternalAccessLog,
  listExternalAuditors,
  revokeExternalAuditor,
  saveExternalAuditorGrants,
} from '../../data/externalAuditors';
import { useApp } from '../../context/AppContext';
import {
  GRANT_PERMISSIONS,
  PERMISSION_FIELD,
  describeExpiry,
  permissionMatrix,
  SIGNUP_DISABLED_HINT,
  type ExpiryKind,
  type ExternalAccessEntry,
  type ExternalAuditorGrant,
  type GrantPermission,
} from '../../lib/externalAuditors';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { Check, Lock, Plus, Users, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

interface EngagementOption { id: string; title: string; }

/**
 * OA-14: external auditors (F13).
 *
 * The Org Admin invites an external auditor by email (edit_config), chooses time-boxed or permanent
 * access, and edits the per-engagement permission matrix. Access is read-only: an external auditor is
 * a separate principal, never an org role, and every call it makes is logged. The panel shows that
 * log. Revoking a whole account or one grant needs a hold-to-confirm.
 */
export const ExternalAuditorsPanel: React.FC<{ orgId: string }> = ({ orgId }) => {
  const { rawEngagements } = useApp();
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [grants, setGrants] = useState<ExternalAuditorGrant[]>([]);
  const [log, setLog] = useState<ExternalAccessEntry[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<'invite' | 'save' | 'revoke' | null>(null);

  // Invite form.
  const [email, setEmail] = useState('');
  const [expiryKind, setExpiryKind] = useState<ExpiryKind>('time_boxed');
  const [accessDays, setAccessDays] = useState(30);
  const [selectedEngagements, setSelectedEngagements] = useState<string[]>([]);

  const engagements: EngagementOption[] = useMemo(
    () => rawEngagements.map((e) => ({ id: e.id, title: e.title })), [rawEngagements]);

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      const [g, l] = await Promise.all([
        listExternalAuditors(orgId), listExternalAccessLog(orgId, 50),
      ]);
      setGrants(g);
      setLog(l);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the external auditors.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const matrix = useMemo(() => permissionMatrix(grants), [grants]);

  const toggleEngagement = (id: string) => {
    setSelectedEngagements((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const invite = async () => {
    setBusy(true);
    setResult(null);
    setLastAction('invite');
    const r = await inviteExternalAuditor({
      email: email.trim(),
      engagementIds: selectedEngagements,
      expiryKind,
      accessDays,
    });
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setEmail('');
      setSelectedEngagements([]);
      await load();
    }
  };

  const saveCell = async (
    userId: string, engagementId: string, permission: GrantPermission
  ) => {
    // Send the full row back so the RPC writes one consistent grant.
    const existing = grants.find((g) => g.userId === userId && g.engagementId === engagementId);
    if (!existing) return;
    const field = PERMISSION_FIELD[permission];
    const next = { ...existing, [field]: !existing[field] };
    setBusy(true);
    setResult(null);
    setLastAction('save');
    const r = await saveExternalAuditorGrants(orgId, [{
      userId, engagementId,
      canViewSummary: next.canViewSummary,
      canDownloadPack: next.canDownloadPack,
      canDownloadCertificate: next.canDownloadCertificate,
      canVerify: next.canVerify,
    }]);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const revoke = async (userId: string, engagementId: string | null) => {
    setBusy(true);
    setResult(null);
    setLastAction('revoke');
    const r = await revokeExternalAuditor(orgId, userId, engagementId);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <div className="py-8 text-center text-secondary text-apple-13" data-testid="oa-auditors-loading">Loading external auditors…</div>;
  }

  return (
    <div className="space-y-4" data-testid="oa-auditors">
      <InlineError message={state === 'error' ? loadError : null} testId="oa-auditors-error" />
      {result && !result.ok && <InlineError message={result.reason} testId="oa-auditors-result-error" />}
      {result && result.ok && (
        <div className="text-apple-12 text-accent" data-testid="oa-auditors-result-ok">
          {lastAction === 'invite'
            ? 'Invitation queued. It is not sent yet; it goes out when email is set up.'
            : 'Saved.'}
        </div>
      )}

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Invite an external auditor</h3>
        <p className="text-apple-12 text-secondary">
          An external auditor gets read-only access to the engagements you choose. They are not a
          member of your organisation and can never write anything. {SIGNUP_DISABLED_HINT}
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col gap-1 text-apple-12 text-secondary">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="oa-auditors-email"
              className="px-3 py-2 rounded-xl border border-hairline bg-surface text-apple-13 text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-apple-12 text-secondary">
            Access
            <select
              value={expiryKind}
              onChange={(e) => setExpiryKind(e.target.value as ExpiryKind)}
              data-testid="oa-auditors-expiry-kind"
              className="px-3 py-2 rounded-xl border border-hairline bg-surface text-apple-13 text-primary"
            >
              <option value="time_boxed">Time-boxed</option>
              <option value="permanent">Permanent</option>
            </select>
          </label>
          {expiryKind === 'time_boxed' && (
            <label className="flex flex-col gap-1 text-apple-12 text-secondary">
              Days
              <input
                type="number"
                min={1}
                max={365}
                value={accessDays}
                onChange={(e) => setAccessDays(Number(e.target.value))}
                data-testid="oa-auditors-days"
                className="w-24 px-3 py-2 rounded-xl border border-hairline bg-surface text-apple-13 text-primary"
              />
            </label>
          )}
        </div>
        {expiryKind === 'permanent' && (
          <p className="text-apple-12 text-cinnabar" data-testid="oa-auditors-permanent-warning">
            Permanent access never expires. Revoke it by hand when the engagement closes.
          </p>
        )}
        <fieldset className="space-y-1" data-testid="oa-auditors-engagements">
          <legend className="text-apple-12 text-secondary">Engagements to grant</legend>
          {engagements.length === 0 ? (
            <p className="text-apple-12 text-tertiary" data-testid="oa-auditors-no-engagements">
              No engagements to grant yet.
            </p>
          ) : (
            engagements.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-apple-12 text-primary">
                <input
                  type="checkbox"
                  checked={selectedEngagements.includes(e.id)}
                  onChange={() => toggleEngagement(e.id)}
                  data-testid={`oa-auditors-engagement-${e.id}`}
                />
                {e.title}
              </label>
            ))
          )}
        </fieldset>
        <button
          type="button"
          disabled={busy || email.trim() === ''}
          onClick={() => void invite()}
          data-testid="oa-auditors-invite"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium disabled:opacity-50"
        >
          <Plus className="w-4 h-4 stroke-[1.5]" /> Invite
        </button>
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Permission matrix</h3>
        <p className="text-apple-12 text-secondary">
          Rows are external auditors, columns are permissions. A tick applies across their live
          grants.
        </p>
        {matrix.length === 0 ? (
          <p className="text-apple-12 text-tertiary" data-testid="oa-auditors-matrix-empty">
            No external auditors yet.
          </p>
        ) : (
          <table className="w-full text-apple-12" data-testid="oa-auditors-matrix">
            <thead>
              <tr className="text-secondary text-left">
                <th className="py-1">Auditor</th>
                {GRANT_PERMISSIONS.map((p) => (
                  <th key={p.key} className="py-1">{p.label}</th>
                ))}
                <th className="py-1">Access</th>
                <th className="py-1">Revoke</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => {
                const firstGrant = grants.find((g) => g.userId === row.userId);
                const anyGrant = grants.find((g) => g.userId === row.userId && g.engagementId);
                return (
                  <tr key={row.userId} className="border-t border-hairline" data-testid={`oa-auditors-row-${row.userId}`}>
                    <td className="py-2 text-primary">{row.email}</td>
                    {GRANT_PERMISSIONS.map((p) => (
                      <td key={p.key} className="py-2">
                        <button
                          type="button"
                          disabled={busy || !anyGrant}
                          onClick={() => void saveCell(row.userId, anyGrant?.engagementId ?? '', p.key)}
                          data-testid={`oa-auditors-cell-${row.userId}-${p.key}`}
                          className={`inline-flex items-center ${row.permissions[p.key] ? 'text-accent' : 'text-tertiary'}`}
                        >
                          {row.permissions[p.key] ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    ))}
                    <td className="py-2 text-secondary" data-testid={`oa-auditors-expiry-${row.userId}`}>
                      {firstGrant ? describeExpiry(firstGrant) : '—'}
                    </td>
                    <td className="py-2">
                      <HoldToConfirm
                        label={`Revoke access for ${row.email}`}
                        testId={`oa-auditors-revoke-${row.userId}`}
                        durationMs={2000}
                        onConfirm={() => void revoke(row.userId, null)}
                        className="inline-flex items-center gap-1 text-cinnabar"
                      >
                        <XCircle className="w-3.5 h-3.5 stroke-[1.5]" /> Revoke
                      </HoldToConfirm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h3 className="text-apple-14 font-semibold text-primary flex items-center gap-2">
          <Users className="w-4 h-4 stroke-[1.5]" /> Access log
        </h3>
        <p className="text-apple-12 text-secondary">Every call an external auditor makes is recorded here.</p>
        {log.length === 0 ? (
          <p className="text-apple-12 text-tertiary" data-testid="oa-auditors-log-empty">No access yet.</p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="oa-auditors-log">
            {log.map((entry) => (
              <li key={entry.id} className="py-2 text-apple-12 text-primary flex items-center justify-between">
                <span>{entry.functionName}</span>
                <span className={entry.outcome === 'ok' ? 'text-accent' : 'text-cinnabar'}>{entry.outcome}</span>
                <span className="text-tertiary">{new Date(entry.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
