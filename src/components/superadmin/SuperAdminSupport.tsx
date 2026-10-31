import React, { useCallback, useEffect, useState } from 'react';
import {
  grantSupportAccess, listJobHealth, listSupportGrants, revokeSupportAccess,
  supportGrantActive, supportListEngagements, supportReadObject, supportAccessLog,
  type JobHealthRow, type SupportAccessLogRow, type SupportEngagement, type SupportGrantRow,
} from '../../data/platform';
import type { DataResult } from '../../data/db';
import { DiagnosticPanel } from '../admin/DiagnosticPanel';
import { InlineError } from '../common/InlineError';
import { Shield, Clock } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Support access panel (C4, spec §24; C2.9 session).
 *
 * Two things live here. The grants are time-boxed and revocable metadata. The session below is the
 * read-only access those grants unlock: it is refused in the database unless a live content_read
 * grant exists, it returns only the granted org's objects, and every call (including every refusal)
 * is written to support_access_log, which the tenant can read. Nothing here writes tenant content.
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
  const [jobs, setJobs] = useState<JobHealthRow[]>([]);
  const [jobsError, setJobsError] = useState('');
  const [sessionOrgId, setSessionOrgId] = useState('');
  const [sessionState, setSessionState] = useState<'closed' | 'open'>('closed');
  const [engagements, setEngagements] = useState<SupportEngagement[]>([]);
  const [readLabel, setReadLabel] = useState('');
  const [readFields, setReadFields] = useState<{ key: string; value: string }[]>([]);
  const [sessionError, setSessionError] = useState('');
  const [trail, setTrail] = useState<SupportAccessLogRow[]>([]);

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
    try {
      setJobs(await listJobHealth());
      setJobsError('');
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Could not read the scheduled jobs.');
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
          A grant is the key to an authenticated, read-only support session. Without a live grant the
          platform reads nothing at all; with one it reads only that tenant's objects, and every read
          is written to the tenant's own trail.
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

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="superadmin-support-session">
        <h3 className="text-apple-14 font-semibold text-primary">Read-only support session</h3>
        <p className="text-apple-12 text-secondary">
          Open a session for a tenant that has granted you content_read. The database checks the
          grant on every call; an expired or revoked grant closes the session on the next read. No
          call here writes tenant content.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="text-apple-11 text-secondary">Tenant id</span>
            <input
              value={sessionOrgId}
              onChange={(e) => setSessionOrgId(e.target.value)}
              className="w-64 p-2 rounded-lg bg-surface-elevated border border-hairline text-apple-12 text-primary outline-none"
              placeholder="00000000-0000-0000-0000-000000000000"
              data-testid="superadmin-support-session-org"
            />
          </label>
          <button
            type="button"
            disabled={busy || sessionOrgId.trim() === ''}
            onClick={async () => {
              const org = sessionOrgId.trim();
              setBusy(true);
              setSessionError('');
              try {
                const live = await supportGrantActive(org);
                if (!live) {
                  setSessionState('closed');
                  setEngagements([]);
                  setTrail([]);
                  setSessionError('No live content_read grant for that tenant. The session stays closed.');
                } else {
                  setEngagements(await supportListEngagements(org));
                  setTrail(await supportAccessLog(org));
                  setSessionState('open');
                }
              } catch (err) {
                setSessionState('closed');
                setSessionError(err instanceof Error ? err.message : 'Could not open the session.');
              } finally {
                setBusy(false);
              }
            }}
            className="px-3 py-2 rounded-lg bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            data-testid="superadmin-support-session-open"
          >
            Open session
          </button>
        </div>
        <InlineError message={sessionError || null} testId="superadmin-support-session-error" />
        {sessionState === 'open' && (
          <div className="space-y-3" data-testid="superadmin-support-session-open-panel">
            <p className="text-apple-11 text-tertiary" data-testid="superadmin-support-session-count">
              {engagements.length} engagement{engagements.length === 1 ? '' : 's'} in the grant's scope.
            </p>
            {engagements.length === 0 ? (
              <p className="text-apple-12 text-secondary py-2" data-testid="superadmin-support-session-empty">
                The grant is live but this tenant has no engagements yet.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="superadmin-support-session-list">
                {engagements.map((e) => (
                  <li key={e.engagementId} className="rounded-xl border border-hairline bg-surface-elevated p-3"
                      data-testid={`support-engagement-${e.engagementId}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-apple-12 font-medium text-primary">{e.title}</span>
                      <span className="text-apple-11 text-tertiary">{e.stage}{e.sealed ? ' · sealed' : ''}</span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setSessionError('');
                        try {
                          const rows = await supportReadObject('engagement', e.engagementId, sessionOrgId.trim());
                          setReadLabel(rows[0]?.label ?? '');
                          setReadFields(
                            Object.entries(rows[0]?.detail ?? {}).map(([key, value]) => ({
                              key, value: String(value),
                            }))
                          );
                          setTrail(await supportAccessLog(sessionOrgId.trim()));
                        } catch (err) {
                          setSessionError(err instanceof Error ? err.message : 'Could not read the object.');
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="mt-2 px-2.5 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:bg-surface transition-colors"
                      data-testid={`support-read-${e.engagementId}`}
                    >
                      Read this engagement
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {readLabel && (
              <div className="text-apple-11 text-secondary" data-testid="superadmin-support-session-read-result">
                <p>Read {readLabel}:</p>
                <ul className="space-y-0.5">
                  {readFields.map((f) => (
                    <li key={f.key} data-testid={`support-read-field-${f.key}`}>
                      {f.key}: {f.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {trail.length > 0 && (
              <div data-testid="superadmin-support-session-trail">
                <p className="text-apple-11 text-secondary mb-1">This tenant's trail (what you read, and every refusal):</p>
                <ul className="space-y-1">
                  {trail.map((t) => (
                    <li key={t.id} className="text-apple-11 text-tertiary">
                      {t.createdAt} · {t.functionName} · {t.outcome}{t.objectKind ? ` · ${t.objectKind}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="superadmin-job-health">
        <h3 className="text-apple-14 font-semibold text-primary">Scheduled jobs</h3>
        <p className="text-apple-12 text-secondary">
          Every background job and its last run, read from the scheduler itself. A job that has
          never run, or whose last run failed, is shown as such.
        </p>
        {jobsError ? (
          <InlineError message={jobsError} testId="superadmin-job-health-error" />
        ) : jobs.length === 0 ? (
          <p className="text-apple-12 text-secondary py-4" data-testid="superadmin-job-health-empty">
            No scheduled jobs are registered. The scheduler extension is not installed on this
            database, so the jobs run only when an administrator calls them.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="superadmin-job-health-list">
            {jobs.map((j) => {
              const failed = j.lastStatus != null && j.lastStatus !== 'succeeded';
              const never = j.lastStart == null;
              return (
                <li key={j.jobId} className="rounded-xl border border-hairline bg-surface-elevated p-3" data-testid={`job-${j.jobName}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-apple-12 font-medium text-primary">{j.jobName}</span>
                    <span className="text-apple-11 text-tertiary">{j.schedule}</span>
                  </div>
                  <p className="text-apple-11 text-secondary mt-1" data-testid={`job-status-${j.jobName}`}>
                    {never ? 'Has not run yet' : `Last run ${j.lastStatus ?? 'unknown'}`}
                    {j.lastStart ? ` at ${j.lastStart}` : ''}
                    {failed && j.lastMessage ? ` — ${j.lastMessage}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* The platform self-diagnostic (spec §11.1): the pure engine over the platform's counts and
          flags. It reads no tenant content (Law L2) and names the rule behind every finding. */}
      <DiagnosticPanel scope="platform" screenId="SA-02" />

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
