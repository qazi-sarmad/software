import React, { useCallback, useEffect, useState } from 'react';
import {
  adoptConfig, distributeConfig, grantJointShare, listAssociatedOrgs, listConfigDistributions,
  listJointShares, listJointSharesWithMe, listShareableEngagements, revokeJointShare,
  type AssociatedOrg, type ConfigDistributionRow, type JointShareRow, type JointShareWithMeRow,
  type ShareableEngagement,
} from '../../data/shares';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Users, Eye, Shield, Check, Database } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Group / joint-audit sharing and group configuration (§2, SCALE-1 WP2).
 *
 * A joint audit may span associated (group) companies and is shared with EDIT rights to both: each
 * party reads and writes the engagement and its working papers, and nothing else of either party is
 * exposed. A share needs the manage_engagements right and a platform-recorded association. The group
 * parent may distribute a configuration snapshot to a member. Every rule is enforced in the
 * database; the refusals render inline (no blocking modal).
 */
export interface SharePanelProps {
  /**
   * 'manage' (default): the granting screen, reached from the Assurance control plane (edit_config).
   * 'grantee': the "Shared with you" surface, reachable by any signed-in member so a counterparty can
   * open a joint audit without holding edit_config.
   */
  mode?: 'manage' | 'grantee';
}

export const SharePanel: React.FC<SharePanelProps> = ({ mode = 'manage' }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [granted, setGranted] = useState<JointShareRow[]>([]);
  const [withMe, setWithMe] = useState<JointShareWithMeRow[]>([]);
  const [counterparties, setCounterparties] = useState<AssociatedOrg[]>([]);
  const [engagements, setEngagements] = useState<ShareableEngagement[]>([]);
  const [distributions, setDistributions] = useState<ConfigDistributionRow[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [engagementId, setEngagementId] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [memberId, setMemberId] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const w = await listJointSharesWithMe();
      setWithMe(w);
      if (mode === 'manage') {
        const [g, c, d, e] = await Promise.all([
          listJointShares(), listAssociatedOrgs(), listConfigDistributions(), listShareableEngagements(),
        ]);
        setGranted(g);
        setCounterparties(c);
        setDistributions(d);
        setEngagements(e);
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the sharing settings.');
      setState('error');
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const onGrant = async () => {
    setBusy(true);
    const r = await grantJointShare(engagementId, counterpartyId, expiresAt ? `${expiresAt}T00:00:00Z` : null);
    setResult(r);
    if (r.ok) {
      setEngagementId('');
      setCounterpartyId('');
      setExpiresAt('');
      await load();
    }
    setBusy(false);
  };

  const onRevoke = async (id: string) => {
    setBusy(true);
    setResult(await revokeJointShare(id, revokeReason));
    setRevokeReason('');
    await load();
    setBusy(false);
  };

  const onDistribute = async () => {
    setBusy(true);
    setResult(await distributeConfig(memberId, null));
    setMemberId('');
    await load();
    setBusy(false);
  };

  const onAdopt = async (id: string) => {
    setBusy(true);
    const r = await adoptConfig(id);
    setResult(r.ok ? { ok: true } : r);
    await load();
    setBusy(false);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="share-panel-loading">Loading sharing…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="share-panel-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline" data-testid="share-panel-retry">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="share-panel">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          {mode === 'grantee' ? 'Joint audits shared with you' : 'Group sharing and joint audits'}
        </h2>
        <p className="text-apple-12 text-secondary">
          A joint audit may span associated group companies and is shared with edit rights to both
          parties. A share needs the manage-engagements right and a recorded group association, and
          exposes only the shared engagement and its working papers.
        </p>
      </header>

      {mode === 'manage' && (
        <>
          <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="share-panel-grant">
            <h3 className="text-apple-13 font-semibold text-primary">Start a joint audit</h3>
            {counterparties.length === 0 ? (
              <p className="text-apple-12 text-secondary" data-testid="share-no-counterparties">
                Your organisation has no associated group companies yet. The platform owner links
                group companies.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={engagementId} onChange={(e) => setEngagementId(e.target.value)}
                    aria-label="Engagement" data-testid="share-grant-engagement"
                    className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
                  >
                    <option value="">Choose an engagement…</option>
                    {engagements.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                  </select>
                  <select
                    value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}
                    aria-label="Counterparty group company" data-testid="share-grant-counterparty"
                    className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
                  >
                    <option value="">Choose a group company…</option>
                    {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input
                    type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                    aria-label="Expiry (optional)" data-testid="share-grant-expiry"
                    className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
                  />
                </div>
                <button
                  type="button" disabled={busy || !engagementId || !counterpartyId} onClick={() => void onGrant()}
                  data-testid="share-grant-submit"
                  className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Share with edit rights to both
                </button>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="share-panel-granted">
            <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" /> Joint audits your organisation shares
            </h3>
            {granted.length === 0 ? (
              <p className="text-apple-12 text-secondary" data-testid="share-granted-empty">No joint audits have been shared.</p>
            ) : (
              <ul className="space-y-2">
                {granted.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-apple-12" data-testid={`share-row-${s.id}`}>
                    <span className="text-primary">{s.engagementTitle || s.engagementId} → {s.counterpartyName}</span>
                    <span className="text-secondary">{s.live ? 'live' : s.revokedAt ? 'revoked' : 'expired'}</span>
                    {s.live && (
                      <span className="flex items-center gap-1">
                        <input
                          type="text" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)}
                          placeholder="Reason" aria-label="Revoke reason" data-testid={`share-revoke-reason-${s.id}`}
                          className="w-28 rounded-lg border border-hairline bg-canvas px-2 py-1 text-apple-11"
                        />
                        <button
                          type="button" disabled={busy} onClick={() => void onRevoke(s.id)}
                          data-testid={`share-revoke-${s.id}`}
                          className="px-2 py-1 rounded-lg border border-hairline text-apple-11 text-secondary hover:text-primary disabled:opacity-40"
                        >
                          Revoke
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="share-panel-config">
            <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
              <Database className="w-3.5 h-3.5" /> Group configuration
            </h3>
            <p className="text-apple-12 text-secondary">
              A group parent may distribute the current configuration snapshot to a member company.
              The member adopts the snapshot into its own history; a later change at the parent never
              alters it.
            </p>
            {counterparties.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={memberId} onChange={(e) => setMemberId(e.target.value)}
                  aria-label="Member company" data-testid="share-config-member"
                  className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
                >
                  <option value="">Choose a member company…</option>
                  {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button
                  type="button" disabled={busy || !memberId} onClick={() => void onDistribute()}
                  data-testid="share-config-distribute"
                  className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
                >
                  Distribute configuration
                </button>
              </div>
            )}
            {distributions.length === 0 ? (
              <p className="text-apple-12 text-secondary" data-testid="share-config-empty">No configuration has been distributed.</p>
            ) : (
              <ul className="space-y-2">
                {distributions.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-apple-12" data-testid={`share-config-row-${d.id}`}>
                    <span className="text-primary">{d.parentName} → {d.memberName} ({d.keys.join(', ') || 'no keys'})</span>
                    <button
                      type="button" disabled={busy} onClick={() => void onAdopt(d.id)}
                      data-testid={`share-config-adopt-${d.id}`}
                      className="px-2 py-1 rounded-lg border border-hairline text-apple-11 text-secondary hover:text-primary disabled:opacity-40"
                    >
                      Adopt
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="share-panel-with-me">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Eye className="w-3.5 h-3.5" /> Joint audits shared with you
        </h3>
        {withMe.length === 0 ? (
          <p className="text-apple-12 text-secondary" data-testid="share-with-me-empty">No joint audits have been shared with you.</p>
        ) : (
          <ul className="space-y-2">
            {withMe.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-apple-12" data-testid={`share-with-me-${s.id}`}>
                <span className="text-primary">{s.engagementTitle} ({s.ownerName})</span>
                <span className="text-secondary">{s.live ? 'live, edit rights' : 'not live'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {result && (
        <div
          className={`rounded-xl border px-3 py-2 text-apple-12 ${result.ok ? 'border-hairline text-secondary' : 'border-danger text-danger'}`}
          data-testid="share-panel-result"
        >
          {result.ok ? (<span className="flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved.</span>) : result.reason}
        </div>
      )}
    </div>
  );
};
