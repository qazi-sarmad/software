import React, { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeConsultation, endConsultation, getActiveConsultation, requestConsultation,
  type ConsultationKind, type ConsultationSession,
} from '../../data/consultation';
import { listTenants, type TenantRow } from '../../data/platform';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Clock, Shield } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const KIND_LABEL: Record<ConsultationKind, string> = {
  config: 'Tier 1 — Configuration help',
  full_admin: 'Tier 2 — Full admin help (client invited)',
};

/**
 * Dual Session console (SA-09, F4). The platform side of the two-tier consultation: request a
 * session for a tenant, acknowledge an invitation, and end a session. A session never grants audit
 * content (spec §24). Non-blocking; the live banner is GL-01.
 */
export const SuperAdminConsultation: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [sessions, setSessions] = useState<Record<string, ConsultationSession | null>>({});
  const [orgId, setOrgId] = useState('');
  const [kind, setKind] = useState<ConsultationKind>('config');
  const [hours, setHours] = useState('2');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const rows = await listTenants();
      setTenants(rows);
      const active: Record<string, ConsultationSession | null> = {};
      for (const t of rows) active[t.id] = await getActiveConsultation(t.id);
      setSessions(active);
      setOrgId((prev) => prev || rows[0]?.id || '');
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load consultation sessions.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<DataResult>) => {
    setBusy(true);
    setResult(null);
    const r = await action();
    setResult(r);
    setBusy(false);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return (
      <div className="text-secondary text-apple-13 py-12 text-center" data-testid="superadmin-consultation-loading">
        Loading consultation sessions…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-consultation-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="superadmin-consultation">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-consultation-result" />

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Start a consultation</h3>
        <p className="text-apple-12 text-secondary">
          Tier 1 lets you make an Org Admin configuration change straight away. Tier 2 is only
          available when the client invites you, and each change waits for their approval.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Tenant</span>
            <Select
              ariaLabel="Tenant for the consultation"
              value={orgId}
              onChange={setOrgId}
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Tier</span>
            <Select
              ariaLabel="Consultation tier"
              value={kind}
              onChange={(v) => setKind(v as ConsultationKind)}
              options={[
                { value: 'config', label: KIND_LABEL.config },
                { value: 'full_admin', label: KIND_LABEL.full_admin },
              ]}
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Hours</span>
            <input
              type="number"
              min={1}
              max={kind === 'full_admin' ? 4 : 8}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              data-testid="superadmin-consultation-hours"
              className="w-20 px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
            />
          </label>
          <button
            type="button"
            disabled={busy || !orgId}
            onClick={() => void run(() => requestConsultation(orgId, kind, Number(hours) || 2))}
            data-testid="superadmin-consultation-request"
            className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
          >
            Request session
          </button>
        </div>
      </div>

      {tenants.length === 0 ? (
        <div className="text-secondary text-apple-13 py-8 text-center" data-testid="superadmin-consultation-empty">
          There are no tenants yet.
        </div>
      ) : (
        <div className="rounded-2xl border border-hairline bg-surface overflow-hidden">
          <table className="w-full text-apple-12">
            <thead className="bg-surface-sunken text-secondary">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Tenant</th>
                <th className="text-left px-4 py-2 font-semibold">Tier</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Ends</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const s = sessions[t.id];
                return (
                  <tr key={t.id} className="border-t border-hairline" data-testid={`superadmin-consultation-${t.id}`}>
                    <td className="px-4 py-2 text-primary font-medium">{t.name}</td>
                    <td className="px-4 py-2 text-secondary">{s ? KIND_LABEL[s.kind] : '—'}</td>
                    <td className="px-4 py-2 text-secondary">{s ? s.status : 'no session'}</td>
                    <td className="px-4 py-2 text-tertiary whitespace-nowrap">
                      {s ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(s.expiresAt).toLocaleTimeString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {s && s.status === 'requested' && s.initiatedBySide === 'tenant' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => acknowledgeConsultation(s.id))}
                          data-testid={`superadmin-consultation-ack-${t.id}`}
                          className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline"
                        >
                          <Shield className="w-3 h-3" />
                          Acknowledge
                        </button>
                      )}
                      {s && s.status === 'active' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => endConsultation(s.id))}
                          data-testid={`superadmin-consultation-end-${t.id}`}
                          className="text-apple-12 text-cinnabar hover:underline"
                        >
                          End
                        </button>
                      )}
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
