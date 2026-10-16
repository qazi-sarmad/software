import React, { useCallback, useEffect, useState } from 'react';
import {
  grantSupportAccess, listSupportGrants, revokeSupportAccess,
  type SupportGrantRow,
} from '../../data/platform';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Shield, Clock } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Support access panel (C4, spec §24). Grants are metadata only: they never give the platform read
 * access to tenant business tables (proven by SQL test 40). A grant is time-boxed and can be
 * revoked with a recorded reason. Non-blocking; revoke uses an inline reason field.
 */
export const SuperAdminSupport: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [grants, setGrants] = useState<SupportGrantRow[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [orgId, setOrgId] = useState('');
  const [hours, setHours] = useState('4');
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setGrants(await listSupportGrants());
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load support grants.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-support-loading">
        Loading support grants…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-support-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="space-y-6" data-testid="superadmin-support">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-support-result" />

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Request a time-boxed grant</h3>
        <p className="text-apple-12 text-secondary">
          A grant is metadata used by an authenticated support session (Phase 9/10). It never gives
          the platform read access to tenant business content.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-apple-11 text-secondary">Tenant id</span>
            <input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-64 p-2 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label className="space-y-1">
            <span className="text-apple-11 text-secondary">Duration (hours)</span>
            <input
              type="number"
              min={1}
              max={48}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-24 p-2 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
            />
          </label>
          <button
            type="button"
            disabled={busy || orgId.trim() === ''}
            onClick={async () => {
              setBusy(true);
              setResult(null);
              const r = await grantSupportAccess(orgId.trim(), {}, Number(hours));
              setBusy(false);
              setResult(r);
              if (r.ok) await load();
            }}
            className="px-3 py-2 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            Grant access
          </button>
        </div>
      </div>

      {grants.length === 0 ? (
        <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-support-empty">
          No support grants have been created.
        </div>
      ) : (
        <div className="space-y-3">
          {grants.map((g) => {
            const expired = new Date(g.expiresAt).getTime() < now;
            const revoked = Boolean(g.revokedAt);
            return (
              <div key={g.id} className="rounded-2xl border border-hairline bg-surface p-4" data-testid={`grant-${g.id}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-secondary" />
                    <div>
                      <p className="text-apple-13 font-medium text-primary">Tenant {g.orgId}</p>
                      <p className="text-apple-11 text-tertiary flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {revoked ? `Revoked: ${g.revokeReason ?? '—'}` : expired ? 'Expired' : `Expires ${g.expiresAt}`}
                      </p>
                    </div>
                  </div>
                  {!revoked && !expired && (
                    <div className="flex items-center gap-2">
                      <input
                        value={revokeReason[g.id] ?? ''}
                        onChange={(e) => setRevokeReason((d) => ({ ...d, [g.id]: e.target.value }))}
                        placeholder="Reason"
                        className="w-40 p-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy || (revokeReason[g.id] ?? '').trim().length < 4}
                        onClick={async () => {
                          setBusy(true);
                          setResult(null);
                          const r = await revokeSupportAccess(g.id, (revokeReason[g.id] ?? '').trim());
                          setBusy(false);
                          setResult(r);
                          if (r.ok) await load();
                        }}
                        className="px-2.5 py-1 rounded-lg border border-cinnabar text-cinnabar text-apple-12 hover:bg-cinnabar-subtle disabled:opacity-40 transition-colors"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
