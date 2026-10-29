import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  archiveActivityPeriod,
  archivePopulation,
  listActivityLog,
  listArchiveJobs,
  listPopulationArchiveDue,
  listPopulationArchives,
  uploadArchiveJob,
  type ActivityLogRow,
  type ArchiveJobRow,
  type PopulationArchiveRow,
} from '../../data/archival';
import { exportActivityLog, logExport } from '../../data/exports';
import { downloadExport, exportContentHash, serialiseExport } from '../../lib/exportSerialise';
import { InlineError } from '../common/InlineError';
import { Activity, Download, Lock, RefreshCw, Archive as ArchiveIcon } from '../common/Icons';

/** Default archive window: the previous calendar month. */
function previousMonth(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/**
 * Activity log view (7G, spec §25.4, §26). A filterable table of the tenant's own activity history
 * with an export button and an admin-only archival trigger. Archival moves a period out of the live
 * table into archive_jobs with a content hash (migration 0043); a pending job can then be uploaded to
 * Storage by the `archive-upload` edge function, which hashes what it stored and lets the database
 * decide whether the job is done. The same view carries population retention (§25.4): the due list
 * and the archive action, so a finalised population past its window can be preserved and verified.
 * RLS shows rows only to cia / org_admin.
 */
export const ActivityLogPanel: React.FC = () => {
  const { currentUser } = useApp();
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [jobs, setJobs] = useState<ArchiveJobRow[]>([]);
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState<ArchiveJobRow | null>(null);
  // Population retention (C2.5, §25.4): a population past its retention window is archived so its
  // bytes are preserved with a content hash and an upload is verified. The wrappers existed with no
  // caller; this is the surface that reads the due list and acts on it.
  const [due, setDue] = useState<{ populationId: string; engagementId: string; finalisedAt: string; dueAt: string }[]>([]);
  const [popArchives, setPopArchives] = useState<PopulationArchiveRow[]>([]);
  const [popBusy, setPopBusy] = useState(false);
  const [popNotice, setPopNotice] = useState<string | null>(null);

  const canArchive = hasRight(currentUser, 'manage_engagements');
  const canExport = hasRight(currentUser, 'perform_work');
  const orgId = currentUser.orgId ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [log, archive, populationDue, populationArchives] = await Promise.all([
        listActivityLog(since || null, until || null),
        listArchiveJobs(),
        orgId ? listPopulationArchiveDue(orgId) : Promise.resolve([]),
        listPopulationArchives(),
      ]);
      setRows(log);
      setJobs(archive);
      setDue(populationDue);
      setPopArchives(populationArchives);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the activity log.');
    } finally {
      setLoading(false);
    }
  }, [since, until, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await exportActivityLog(orgId, since || null, until || null);
      const text = serialiseExport(payload, 'csv');
      const hash = await exportContentHash(text);
      await logExport('activity_log', orgId, 'csv', { since, until }, hash);
      downloadExport(text, 'activity-log-export.csv');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The export could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const doArchive = async () => {
    const window = previousMonth();
    setBusy(true);
    setError(null);
    setArchived(null);
    try {
      const r = await archiveActivityPeriod(orgId, window.start, window.end);
      if (!r.ok) {
        setError(r.reason);
      } else {
        const refreshed = await listArchiveJobs();
        setJobs(refreshed);
        setArchived(refreshed[0] ?? null);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archival could not be started.');
    } finally {
      setBusy(false);
    }
  };

  /** Upload a pending activity archive to Storage (C2.5). The edge function stores the bytes and the
   *  database decides whether the job is done; nothing is marked archived on this call alone. */
  const doUpload = async (archiveId: string) => {
    setPopBusy(true);
    setError(null);
    try {
      const r = await uploadArchiveJob(archiveId);
      if (!r.ok) setError(r.reason);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The archive could not be uploaded.');
    } finally {
      setPopBusy(false);
    }
  };

  /** Archive a population whose retention window has elapsed (§25.4). Rows are not removed; the
   *  archive records the content hash so the bytes can be re-derived and verified later. */
  const doArchivePopulation = async (populationId: string) => {
    setPopBusy(true);
    setError(null);
    setPopNotice(null);
    try {
      const r = await archivePopulation(populationId);
      if (!r.ok) {
        setError(r.reason);
      } else {
        setPopNotice('Population archived; its content hash is recorded for later verification.');
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The population could not be archived.');
    } finally {
      setPopBusy(false);
    }
  };

  const visible = filter
    ? rows.filter((r) => r.action.toLowerCase().includes(filter.toLowerCase()))
    : rows;

  return (
    <div className="p-6 space-y-6" data-testid="activity-log-panel">
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent" />
          <h2 className="text-apple-16 font-bold text-primary">Activity log</h2>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <button type="button" onClick={() => void doExport()} disabled={busy} data-testid="activity-export" className="px-3 py-1.5 rounded-xl text-apple-12 font-semibold bg-surface border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
          {canArchive && (
            <button type="button" onClick={() => void doArchive()} disabled={busy} data-testid="activity-archive" className="px-3 py-1.5 rounded-xl text-apple-12 font-semibold bg-surface border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50 flex items-center gap-1.5">
              <ArchiveIcon className="w-3.5 h-3.5" /> Archive last month
            </button>
          )}
          <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      <InlineError message={error} testId="activity-error" onDismiss={() => setError(null)} />

      {archived && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-apple-12 text-primary bg-verdigris-subtle border border-verdigris" data-testid="activity-archived-notice">
          <Lock className="w-4 h-4 shrink-0" />
          Archived {archived.archivedRowCount} rows ({archived.periodStart} → {archived.periodEnd}); content hash{' '}
          <span className="font-mono">{archived.contentHash?.slice(0, 12) ?? '—'}…</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3" data-testid="activity-filters">
        <label className="space-y-1">
          <span className="block text-apple-11 font-semibold text-secondary uppercase">Action contains</span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            data-testid="activity-filter"
            className="px-3 py-1.5 rounded-xl text-apple-12 bg-surface border border-hairline text-primary"
            placeholder="e.g. sign_off"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-apple-11 font-semibold text-secondary uppercase">Since</span>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} data-testid="activity-since" className="px-3 py-1.5 rounded-xl text-apple-12 bg-surface border border-hairline text-primary" />
        </label>
        <label className="space-y-1">
          <span className="block text-apple-11 font-semibold text-secondary uppercase">Until</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} data-testid="activity-until" className="px-3 py-1.5 rounded-xl text-apple-12 bg-surface border border-hairline text-primary" />
        </label>
      </div>

      {loading ? (
        <p className="text-secondary text-apple-13 py-6 text-center" data-testid="activity-loading">Loading activity…</p>
      ) : visible.length === 0 ? (
        <p className="text-secondary text-apple-13 py-6 text-center" data-testid="activity-empty">No activity matches these filters.</p>
      ) : (
        <table className="w-full text-apple-12" data-testid="activity-table">
          <thead className="text-secondary">
            <tr>
              <th className="text-left py-1.5 font-semibold">When</th>
              <th className="text-left py-1.5 font-semibold">Action</th>
              <th className="text-left py-1.5 font-semibold">Object</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-hairline" data-testid={`activity-row-${r.id}`}>
                <td className="py-1.5 text-secondary">{r.ts ? new Date(r.ts).toLocaleString() : '—'}</td>
                <td className="py-1.5 text-primary font-mono">{r.action}</td>
                <td className="py-1.5 text-secondary">{r.objectType ?? '—'}{r.objectId ? ` · ${r.objectId.slice(0, 8)}…` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="space-y-2" data-testid="archive-jobs">
        <h3 className="text-apple-13 font-semibold text-primary">Archive jobs</h3>
        {jobs.length === 0 ? (
          <p className="text-secondary text-apple-13 py-2" data-testid="archive-jobs-empty">Nothing has been archived yet.</p>
        ) : (
          <ul className="space-y-1">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between text-apple-12 border-t border-hairline py-1.5" data-testid={`archive-job-${j.id}`}>
                <span className="text-primary">{j.periodStart} → {j.periodEnd}</span>
                <span className="flex items-center gap-2">
                  <span className="text-secondary">{j.archivedRowCount} rows · {j.status}</span>
                  {canArchive && j.status === 'pending' && (
                    <button type="button" onClick={() => void doUpload(j.id)} disabled={popBusy} data-testid={`archive-upload-${j.id}`} className="px-2 py-1 rounded-lg text-apple-11 font-semibold bg-surface border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
                      Upload
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* §25.4: population retention. A finalised population past its retention window is due to be
          archived; archiving keeps its bytes with a content hash so they can be re-derived and
          verified. This is the surface the retention rule never had. */}
      <section className="space-y-2" data-testid="population-retention">
        <h3 className="text-apple-13 font-semibold text-primary">Population retention</h3>
        {popNotice && (
          <p className="text-apple-12 text-primary bg-verdigris-subtle border border-verdigris rounded-xl px-3 py-2" data-testid="population-archived-notice">{popNotice}</p>
        )}
        {due.length === 0 ? (
          <p className="text-secondary text-apple-13 py-2" data-testid="population-due-empty">No population is past its retention window.</p>
        ) : (
          <ul className="space-y-1" data-testid="population-due-list">
            {due.map((d) => (
              <li key={d.populationId} className="flex items-center justify-between text-apple-12 border-t border-hairline py-1.5" data-testid={`population-due-${d.populationId}`}>
                <span className="text-primary">{d.engagementId} · finalised {d.finalisedAt}</span>
                <span className="flex items-center gap-2">
                  <span className="text-secondary">due {d.dueAt}</span>
                  {canArchive && (
                    <button type="button" onClick={() => void doArchivePopulation(d.populationId)} disabled={popBusy} data-testid={`population-archive-${d.populationId}`} className="px-2 py-1 rounded-lg text-apple-11 font-semibold bg-surface border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
                      Archive
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {popArchives.length > 0 && (
          <ul className="space-y-1" data-testid="population-archives">
            {popArchives.map((a) => (
              <li key={a.id} className="flex items-center justify-between text-apple-12 border-t border-hairline py-1.5" data-testid={`population-archive-row-${a.id}`}>
                <span className="text-primary">{a.archivedRowCount} rows · {a.status}</span>
                <span className="text-secondary font-mono">{a.contentHash ? `${a.contentHash.slice(0, 12)}…` : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
