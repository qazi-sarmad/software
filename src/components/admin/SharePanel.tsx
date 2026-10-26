import React, { useCallback, useEffect, useState } from 'react';
import {
  grantShare, listShares, listSharesWithMe, revokeShare, setHeadLevel, viewSharedUniverse,
  type ShareRow, type ShareWithMeRow, type SharedUniverseView,
} from '../../data/shares';
import { listMembers, type MemberRow } from '../../data/admin';
import { listUniverses, type UniverseRow } from '../../data/universe';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Users, Eye, Shield, Check } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Cross-universe view-only sharing (§2, WP2/WP6).
 *
 * A Level-1 or Level-2 Head grants view-only access to one universe. The screen shows what the
 * caller has granted and what has been granted to them, and opens the read-only projection. Every
 * rule is enforced in the database; the refusals render inline (no blocking modal).
 */
export interface SharePanelProps {
  /**
   * 'manage' (default): the granting screen, reached from the Assurance control plane (edit_config).
   * 'grantee': the read-only "Shared with you" surface, reachable by any signed-in member so a
   * grantee can open what a Head shared without holding edit_config.
   */
  mode?: 'manage' | 'grantee';
}

export const SharePanel: React.FC<SharePanelProps> = ({ mode = 'manage' }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [granted, setGranted] = useState<ShareRow[]>([]);
  const [withMe, setWithMe] = useState<ShareWithMeRow[]>([]);
  const [universes, setUniverses] = useState<UniverseRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const [universeId, setUniverseId] = useState('');
  const [grantee, setGrantee] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [view, setView] = useState<SharedUniverseView | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const w = await listSharesWithMe();
      setWithMe(w);
      if (mode === 'manage') {
        const [g, u, m] = await Promise.all([listShares(), listUniverses(), listMembers()]);
        setGranted(g);
        setUniverses(u);
        setMembers(m);
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the shares.');
      setState('error');
    }
  }, [mode]);

  useEffect(() => { void load(); }, [load]);

  const onGrant = async () => {
    setBusy(true);
    const r = await grantShare(universeId, grantee, expiresAt ? `${expiresAt}T00:00:00Z` : null);
    setResult(r);
    if (r.ok) {
      setUniverseId('');
      setGrantee('');
      setExpiresAt('');
      await load();
    }
    setBusy(false);
  };

  const onRevoke = async (id: string) => {
    setBusy(true);
    setResult(await revokeShare(id, revokeReason));
    setRevokeReason('');
    await load();
    setBusy(false);
  };

  const onView = async (id: string) => {
    setView(await viewSharedUniverse(id));
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="share-panel-loading">Loading shares…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="share-panel-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline" data-testid="share-panel-retry">Retry</button>
      </div>
    );
  }

  const live = (s: ShareRow) => !s.revokedAt && (!s.expiresAt || s.expiresAt > new Date().toISOString());

  return (
    <div className="space-y-5" data-testid="share-panel">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" /> {mode === 'grantee' ? 'Shared with you (view-only)' : 'Universe sharing (view-only)'}
        </h2>
        <p className="text-apple-12 text-secondary">
          Share one universe with a colleague for viewing only. A Level-1 or Level-2 Head grants and
          revokes; a share never allows a change.
        </p>
      </header>

      {mode === 'manage' && (
        <>
        {/* Grant. */}
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="share-panel-grant">
          <h3 className="text-apple-13 font-semibold text-primary">Grant a share</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <select
              value={universeId} onChange={(e) => setUniverseId(e.target.value)}
              aria-label="Universe" data-testid="share-grant-universe"
              className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
            >
              <option value="">Choose a universe…</option>
              {universes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select
              value={grantee} onChange={(e) => setGrantee(e.target.value)}
              aria-label="Grantee" data-testid="share-grant-grantee"
              className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
            >
              <option value="">Choose a colleague…</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.userId}</option>)}
            </select>
            <input
              type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
              aria-label="Expiry (optional)" data-testid="share-grant-expiry"
              className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
            />
          </div>
          <button
            type="button" disabled={busy || !universeId || !grantee} onClick={() => void onGrant()}
            data-testid="share-grant-submit"
            className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
          >
            Grant view-only share
          </button>
        </section>
  
        {/* Granted by this org. */}
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="share-panel-granted">
          <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> Granted by your organisation
          </h3>
          {granted.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="share-granted-empty">No shares have been granted.</p>
          ) : (
            <ul className="space-y-2">
              {granted.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-apple-12" data-testid={`share-row-${s.id}`}>
                  <span className="text-primary">{s.universeName} → {s.granteeUserId}</span>
                  <span className="text-secondary">{live(s) ? 'live' : s.revokedAt ? 'revoked' : 'expired'}</span>
                  {live(s) && (
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
  
        </>
      )}

      {/* Shared with me. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="share-panel-with-me">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Eye className="w-3.5 h-3.5" /> Shared with you
        </h3>
        {withMe.length === 0 ? (
          <p className="text-apple-12 text-secondary" data-testid="share-with-me-empty">Nothing has been shared with you.</p>
        ) : (
          <ul className="space-y-2">
            {withMe.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-apple-12" data-testid={`share-with-me-${s.id}`}>
                <span className="text-primary">{s.universeName}</span>
                <span className="text-secondary">{s.live ? 'live' : 'not live'}</span>
                <button
                  type="button" disabled={!s.live} onClick={() => void onView(s.id)}
                  data-testid={`share-view-${s.id}`}
                  className="px-2 py-1 rounded-lg border border-hairline text-apple-11 text-secondary hover:text-primary disabled:opacity-40"
                >
                  Open (read-only)
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The read-only projection. */}
      {view && (
        <section className="rounded-2xl border border-hairline bg-canvas p-4 space-y-2" data-testid="share-panel-view">
          <h3 className="text-apple-13 font-semibold text-primary">Shared universe (read-only)</h3>
          {!view.live ? (
            <p className="text-apple-12 text-secondary" data-testid="share-view-not-live">This share is no longer live.</p>
          ) : (
            <>
              <p className="text-apple-12 text-secondary" data-testid="share-view-entities">Entities: {view.entities.map((e) => e.name).join(', ') || 'none'}</p>
              <p className="text-apple-12 text-secondary" data-testid="share-view-engagements">Engagements: {view.engagements.map((e) => e.title).join(', ') || 'none'}</p>
            </>
          )}
        </section>
      )}

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

/** Exposed so the Org Admin people tab can set Head authority without a second data path. */
export async function setMemberHead(userId: string, level: number | null): Promise<DataResult> {
  return setHeadLevel(userId, level);
}
