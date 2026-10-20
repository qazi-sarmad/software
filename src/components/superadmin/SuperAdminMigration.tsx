import React, { useCallback, useEffect, useState } from 'react';
import { listMigrationJobs, type MigrationJob } from '../../data/hostingFit';
import { listTenants, type TenantRow } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { Database, RefreshCw, Clock, CheckCircle, AlertTriangle, Download } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_LABEL: Record<string, string> = {
  created: 'Created', running: 'Running', failed: 'Failed', awaiting_cutover: 'Awaiting cutover',
  retired: 'Retired', rolled_back: 'Rolled back',
};

/**
 * SA-12 migration jobs (F16). Platform staff pick a tenant and watch its migration job: progress,
 * per-step rows and checkpoints, the retention window, resume and rollback state. Read-only over the
 * data module; nothing here is JSON. The runner itself is a separate Node package.
 */
export const SuperAdminMigration: React.FC = () => {
  const [tenantState, setTenantState] = useState<LoadState>('loading');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [orgId, setOrgId] = useState('');
  const [state, setState] = useState<LoadState>('ready');
  const [loadError, setLoadError] = useState('');
  const [jobs, setJobs] = useState<MigrationJob[]>([]);

  useEffect(() => {
    let live = true;
    listTenants()
      .then((rows) => {
        if (!live) return;
        setTenants(rows);
        setOrgId(rows[0]?.id ?? '');
        setTenantState('ready');
      })
      .catch((err) => {
        if (!live) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load tenants.');
        setTenantState('error');
      });
    return () => { live = false; };
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) { setJobs([]); return; }
    setState('loading');
    setLoadError('');
    try {
      setJobs(await listMigrationJobs(id));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load migration jobs.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(orgId);
  }, [load, orgId]);

  if (tenantState === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="sa-migration-loading">Loading tenants…</div>;
  }
  if (tenantState === 'error') {
    return <InlineError message={loadError} testId="sa-migration-error" />;
  }

  return (
    <div className="space-y-4" data-testid="sa-migration">
      <div className="flex items-center gap-3">
        <label className="space-y-1">
          <span className="text-apple-12 text-secondary">Tenant</span>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            data-testid="sa-migration-tenant"
            className="px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
          >
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load(orgId)}
          data-testid="sa-migration-refresh"
          className="inline-flex items-center gap-1 mt-5 text-apple-12 text-accent hover:underline"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <InlineError message={state === 'error' ? loadError : null} testId="sa-migration-jobs-error" />

      {state === 'loading' ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="sa-migration-jobs-loading">Loading migration jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="sa-migration-empty">
          No migration jobs for this tenant.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline">
          {jobs.map((j) => (
            <li key={j.id} className="px-4 py-3 space-y-2" data-testid={`sa-migration-job-${j.id}`}>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-secondary" />
                <span className="text-apple-13 font-medium text-primary">{STATUS_LABEL[j.status] ?? j.status}</span>
                <span className="text-apple-12 text-secondary">step {j.currentStep}/{j.totalSteps} · {j.rowsDone} rows</span>
                {j.status === 'failed' && <AlertTriangle className="w-4 h-4 text-cinnabar" />}
                {(j.status === 'awaiting_cutover' || j.status === 'retired') && <CheckCircle className="w-4 h-4 text-verdigris" />}
              </div>
              {j.errorText && <p className="text-apple-12 text-cinnabar" data-testid={`sa-migration-job-error-${j.id}`}>{j.errorText}</p>}
              {j.steps.length > 0 && (
                <ol className="space-y-0.5" data-testid={`sa-migration-steps-${j.id}`}>
                  {j.steps.map((s) => (
                    <li key={s.stepNo} className="text-apple-11 text-secondary">
                      {s.stepNo}. {s.stepKey} · {s.status}{s.rowsDone ? ` · ${s.rowsDone} rows` : ''}
                    </li>
                  ))}
                </ol>
              )}
              {j.retireAfter && (
                <p className="inline-flex items-center gap-1 text-apple-11 text-secondary">
                  <Clock className="w-3 h-3" /> Retire after {j.retireAfter}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/** SA-12 deployment kit (F16). Plain copy with the env template, hosting steps and the guide links. */
export const DeploymentKitPanel: React.FC = () => (
  <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid="sa-deployment-kit">
    <h3 className="inline-flex items-center gap-2 text-apple-14 font-semibold text-primary">
      <Download className="w-4 h-4" /> Deployment Kit
    </h3>
    <p className="text-apple-12 text-secondary">
      An env template with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, the steps for free
      static hosting, and links to the self-host guide. After migration the client runs an
      independent deployment.
    </p>
  </div>
);
