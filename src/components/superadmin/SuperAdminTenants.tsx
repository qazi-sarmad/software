import React, { useCallback, useEffect, useState } from 'react';
import {
  listInviteCaps, listTenants, setFeatureFlag, setInviteCap, setTenantStatus,
  type InviteCapRow, type TenantRow,
} from '../../data/platform';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Shield, ShieldAlert, Check } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const FLAGS: { key: string; label: string }[] = [
  { key: 'exports', label: 'Exports' },
  { key: 'imports', label: 'Imports' },
];

/**
 * Tenants panel (C4, spec §24). Lists tenants and edits platform-only state: status, feature
 * flags and the invite-cap override. Every write is a platform RPC; a tenant session calling one is
 * refused in the database. Non-blocking: suspend uses an inline confirm.
 */
export const SuperAdminTenants: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [caps, setCaps] = useState<Record<string, number>>({});
  const [result, setResult] = useState<DataResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [rows, capRows] = await Promise.all([listTenants(), listInviteCaps()]);
      setTenants(rows);
      setCaps(Object.fromEntries(capRows.map((c: InviteCapRow) => [c.orgId, c.perUserDaily])));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load tenants.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<DataResult>) => {
    setBusyId(id);
    setResult(null);
    const r = await action();
    setBusyId(null);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-tenants-loading">
        Loading tenants…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-tenants-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-tenants-empty">
        No tenants are provisioned yet.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="superadmin-tenants">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-tenants-result" />
      {tenants.map((t) => (
        <div key={t.id} className="rounded-2xl border border-hairline bg-surface p-4" data-testid={`tenant-${t.id}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              {t.status === 'suspended' ? (
                <ShieldAlert className="w-4 h-4 text-cinnabar" />
              ) : (
                <Shield className="w-4 h-4 text-verdigris" />
              )}
              <div>
                <h3 className="text-apple-14 font-semibold text-primary">{t.name}</h3>
                <p className="text-apple-11 text-tertiary">{t.id}</p>
              </div>
            </div>
            <span
              className={`text-apple-11 font-medium px-2 py-0.5 rounded-full ${
                t.status === 'suspended' ? 'bg-cinnabar-subtle text-cinnabar' : 'bg-verdigris-subtle text-verdigris-text'
              }`}
            >
              {t.status}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Status */}
            <div className="space-y-1.5">
              <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wide">Status</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === t.id || t.status === 'active'}
                  onClick={() => void run(t.id, () => setTenantStatus(t.id, 'active'))}
                  className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 hover:bg-surface-hover disabled:opacity-40 transition-colors"
                >
                  Active
                </button>
                <button
                  type="button"
                  disabled={busyId === t.id || t.status === 'suspended'}
                  onClick={() => void run(t.id, () => setTenantStatus(t.id, 'suspended'))}
                  className="px-2.5 py-1 rounded-lg border border-cinnabar text-cinnabar text-apple-12 hover:bg-cinnabar-subtle disabled:opacity-40 transition-colors"
                >
                  Suspend
                </button>
              </div>
            </div>

            {/* Invite cap override */}
            <div className="space-y-1.5">
              <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wide">
                Invite cap / user / day
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={capDraft[t.id] ?? String(caps[t.id] ?? '')}
                  onChange={(e) => setCapDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                  aria-label={`Invite cap for ${t.name}`}
                  className="w-20 p-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
                />
                <button
                  type="button"
                  disabled={busyId === t.id}
                  onClick={() => {
                    const n = Number(capDraft[t.id] ?? caps[t.id]);
                    void run(t.id, () => setInviteCap(t.id, n));
                  }}
                  className="px-2.5 py-1 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  Set
                </button>
              </div>
            </div>
          </div>

          {/* Feature flags */}
          <div className="mt-4">
            <span className="text-apple-11 font-semibold text-secondary uppercase tracking-wide">Feature flags</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {FLAGS.map((f) => {
                const on = Boolean(t.featureFlags[f.key]);
                return (
                  <button
                    key={f.key}
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => void run(t.id, () => setFeatureFlag(t.id, f.key, !on))}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-apple-12 transition-colors disabled:opacity-40 ${
                      on ? 'border-accent bg-accent-subtle text-primary' : 'border-hairline text-secondary hover:text-primary'
                    }`}
                  >
                    {on && <Check className="w-3 h-3" />}
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
