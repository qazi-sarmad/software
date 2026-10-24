import React, { useCallback, useEffect, useState } from 'react';
import { listFeatureCatalogue, listTenantEntitlements, setEntitlement, type FeatureRow } from '../../data/entitlements';
import { listTenants, type TenantRow } from '../../data/platform';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Check, Lock } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-14 features and plans (F25). The platform catalogue with price class, and the per-tenant
 * entitlement matrix. Turning a feature on or off requires a reason and writes append-only,
 * hash-chained history (enforced in the database). Only the Super Admin writes entitlements.
 */
export const SuperAdminFeatures: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [catalogue, setCatalogue] = useState<FeatureRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [orgId, setOrgId] = useState('');
  const [effective, setEffective] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<DataResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async (org: string) => {
    setState('loading');
    setLoadError('');
    try {
      const [cats, rows] = await Promise.all([listFeatureCatalogue(), listTenants()]);
      setCatalogue(cats);
      setTenants(rows);
      const chosen = org || rows[0]?.id || '';
      setOrgId(chosen);
      if (chosen) {
        const ents = await listTenantEntitlements(chosen);
        setEffective(Object.fromEntries(ents.map((e) => [e.featureKey, e.enabled])));
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load features.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const toggle = async (key: string, next: boolean) => {
    const why = (reason[key] ?? '').trim();
    if (!why) {
      setResult({ ok: false, reason: 'A reason is required when you change a feature.' });
      return;
    }
    setBusyKey(key);
    setResult(null);
    const r = await setEntitlement(orgId, key, next, null, why);
    setBusyKey(null);
    setResult(r);
    if (r.ok) {
      setEffective((prev) => ({ ...prev, [key]: next }));
      setReason((prev) => ({ ...prev, [key]: '' }));
    }
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-features-loading">Loading features…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-features-error" />
        <button type="button" onClick={() => void load(orgId)} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="superadmin-features">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-features-result" />

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h3 className="text-apple-14 font-semibold text-primary">Feature catalogue</h3>
        <p className="text-apple-12 text-secondary">
          What the platform can sell. A feature turned off is hidden and refused, never deleted.
        </p>
        <table className="w-full text-apple-12" data-testid="superadmin-feature-catalogue">
          <thead className="text-secondary">
            <tr>
              <th className="text-left py-1 font-semibold">Feature</th>
              <th className="text-left py-1 font-semibold">Group</th>
              <th className="text-left py-1 font-semibold">Price</th>
              <th className="text-left py-1 font-semibold">Default</th>
              <th className="text-left py-1 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {catalogue.map((f) => (
              <tr key={f.key} className="border-t border-hairline" data-testid={`feature-catalogue-${f.key}`}>
                <td className="py-1.5 text-primary font-medium">{f.label}</td>
                <td className="py-1.5 text-secondary">{f.group}</td>
                <td className="py-1.5 text-secondary">{f.priceClass}</td>
                <td className="py-1.5 text-secondary">{f.defaultOn ? 'on' : 'off'}</td>
                <td className="py-1.5 text-tertiary">{f.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tenants.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="superadmin-features-empty">
          There are no tenants yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-apple-14 font-semibold text-primary">Entitlements</h3>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Tenant</span>
              <Select
                ariaLabel="Tenant for entitlements"
                value={orgId}
                onChange={(v) => void load(v)}
                options={tenants.map((t) => ({ value: t.id, label: t.name }))}
              />
            </label>
          </div>
          <table className="w-full text-apple-12" data-testid="superadmin-entitlements">
            <thead className="text-secondary">
              <tr>
                <th className="text-left py-1 font-semibold">Feature</th>
                <th className="text-left py-1 font-semibold">State</th>
                <th className="text-left py-1 font-semibold">Reason (required)</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {catalogue.map((f) => {
                const on = effective[f.key] ?? f.defaultOn;
                return (
                  <tr key={f.key} className="border-t border-hairline" data-testid={`entitlement-${f.key}`}>
                    <td className="py-1.5 text-primary">{f.label}</td>
                    <td className="py-1.5">
                      <span className={`inline-flex items-center gap-1 ${on ? 'text-accent' : 'text-tertiary'}`}>
                        {on ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {on ? 'included' : 'off'}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <input
                        type="text"
                        value={reason[f.key] ?? ''}
                        onChange={(e) => setReason((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder="Why this change"
                        aria-label={`Reason for ${f.label}`}
                        data-testid={`entitlement-reason-${f.key}`}
                        className="w-64 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        disabled={busyKey === f.key}
                        onClick={() => void toggle(f.key, !on)}
                        data-testid={`entitlement-toggle-${f.key}`}
                        className="px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-50"
                      >
                        {on ? 'Turn off' : 'Turn on'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
