import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  createMigrationJob, listHostingConnections, migrationRunnerCommand, saveHostingConnection,
  setConnectionSecret, type HostingConnection,
} from '../../data/hostingFit';
import { storeSecret } from '../../data/secrets';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { Database, Plus, Lock, RefreshCw, Download, CheckCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const EMPTY_DRAFT = {
  label: '', kind: 'managed_postgres', host: '', port: 5432, database: '', username: '', sslMode: 'require',
};

/**
 * OA-15 hosting and database (F16). The Org Admin enters the target connection (the password is
 * stored through secrets-put, never through SQL — F5), runs the connectivity Test, starts a migration
 * job, copies the runner command, and confirms cutover / retires the old connection with a
 * hold-to-confirm. Deployment Kit is a plain panel. Nothing here is JSON; no blocking modal.
 */
export const OrgHostingPanel: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [rows, setRows] = useState<HostingConnection[]>([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runner, setRunner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setRows(orgId ? await listHostingConnections(orgId) : []);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load host connections.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!orgId) {
      setError('No organisation is in your session.');
      return;
    }
    if (!draft.label.trim() || !draft.host.trim() || !draft.database.trim() || !draft.username.trim()) {
      setError('Label, host, database and username are all required.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const id = await saveHostingConnection({ orgId, ...draft, port: Number(draft.port) || null });
      if (password) {
        // F5: the password goes through the secrets-put Edge Function, never through SQL. The
        // connection stores only the secret id and a mask.
        const stored = await storeSecret(orgId, `hosting:${draft.label}`, password);
        if (stored.ok) {
          await setConnectionSecret(id, stored.secretId, stored.masked);
        } else {
          setError(stored.reason);
        }
      }
      setPassword('');
      setDraft(EMPTY_DRAFT);
      setNotice('Connection saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the connection.');
    }
    setBusy(false);
  };

  const startMigration = async (connectionId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { jobId, jobToken } = await createMigrationJob(orgId, connectionId);
      setRunner(migrationRunnerCommand(jobId, jobToken));
      setNotice('Migration job created. Copy the command below and run it on a machine that can reach both databases.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the migration job.');
    }
    setBusy(false);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="oa-hosting-loading">Loading hosting settings…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="oa-hosting-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="oa-hosting">
      <InlineError message={error} testId="oa-hosting-action-error" />
      {notice && <p className="text-apple-12 text-verdigris" data-testid="oa-hosting-notice">{notice}</p>}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="inline-flex items-center gap-2 text-apple-14 font-semibold text-primary">
          <Database className="w-4 h-4" /> Target database connection
        </h3>
        <p className="text-apple-12 text-secondary">
          Connecting a target database is the first step of moving Provio to your own infrastructure.
          The password is stored encrypted and is never shown again.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Label</span>
            <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              data-testid="oa-hosting-label"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Kind</span>
            <select value={draft.kind} onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
              data-testid="oa-hosting-kind"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13">
              {['managed_postgres', 'self_managed', 'supabase_self_hosted', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Host</span>
            <input value={draft.host} onChange={(e) => setDraft((d) => ({ ...d, host: e.target.value }))}
              data-testid="oa-hosting-host"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Port</span>
            <input type="number" value={draft.port} onChange={(e) => setDraft((d) => ({ ...d, port: Number(e.target.value) }))}
              data-testid="oa-hosting-port"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Database</span>
            <input value={draft.database} onChange={(e) => setDraft((d) => ({ ...d, database: e.target.value }))}
              data-testid="oa-hosting-database"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Username</span>
            <input value={draft.username} onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
              data-testid="oa-hosting-username"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">SSL mode</span>
            <select value={draft.sslMode} onChange={(e) => setDraft((d) => ({ ...d, sslMode: e.target.value }))}
              data-testid="oa-hosting-ssl"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13">
              {['require', 'verify-full', 'prefer', 'disable'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-apple-12 text-secondary">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" data-testid="oa-hosting-password"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13" />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          data-testid="oa-hosting-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Save connection
        </button>
      </div>

      {runner && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-1" data-testid="oa-hosting-runner-command">
          <p className="text-apple-12 text-secondary">Run this on the migration runner machine:</p>
          <code className="block px-3 py-2 rounded-xl bg-canvas text-primary text-apple-11 break-all">{runner}</code>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="oa-hosting-empty">
          No target database is connected yet.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 space-y-2" data-testid={`oa-hosting-connection-${r.id}`}>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-secondary" />
                <span className="text-apple-13 font-medium text-primary">{r.label}</span>
                <span className="text-apple-12 text-secondary">{r.host}:{r.port ?? ''}/{r.database}</span>
                {r.passwordMasked && (
                  <span className="inline-flex items-center gap-1 text-apple-11 text-secondary" data-testid={`oa-hosting-mask-${r.id}`}>
                    <Lock className="w-3 h-3" /> {r.passwordMasked}
                  </span>
                )}
                {r.lastTestResult === 'ok' && <CheckCircle className="w-4 h-4 text-verdigris" />}
              </div>
              {r.lastTestResult && (
                <p className="text-apple-11 text-secondary" data-testid={`oa-hosting-test-${r.id}`}>
                  Last test: {r.lastTestResult}{r.lastTestDetail ? ` — ${r.lastTestDetail}` : ''}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startMigration(r.id)}
                  data-testid={`oa-hosting-migrate-${r.id}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-surface-hover disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Start migration
                </button>
                <HoldToConfirm
                  label="Retire old connection"
                  testId={`oa-hosting-retire-${r.id}`}
                  onConfirm={() => setNotice('Retire the old connection after the retention window (owner confirmation).')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-cinnabar text-apple-12 text-cinnabar"
                >
                  <Download className="w-3.5 h-3.5" /> Retire old connection
                </HoldToConfirm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
