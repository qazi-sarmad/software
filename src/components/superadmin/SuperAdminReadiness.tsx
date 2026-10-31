import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignComplaint, commentComplaint, createComplaint, listComplaintEvents, listComplaints,
  listPlatformAdmins, platformReadiness, resolveComplaint, runDiagnostic,
  type ComplaintEvent, type ComplaintRow, type ReadinessReport, type ReadinessSignal, type Severity,
} from '../../data/readiness';
import { listTenants, type TenantRow } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { Check, AlertTriangle, AlertCircle, RefreshCw, Shield, Send } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const VERDICT_STYLE: Record<ReadinessSignal['verdict'], string> = {
  green: 'text-verdigris', amber: 'text-brass', red: 'text-cinnabar',
};

const VERDICT_WORD: Record<ReadinessSignal['verdict'], string> = {
  green: 'Ready', amber: 'Not evaluated', red: 'Broken',
};

/** The tab a fix target deep-links to, or null when the fix is not a screen in this portal. */
const FIX_TABS: Record<string, string> = {
  'sa-email': 'email',
  'sa-integrity': 'integrity',
  'sa-domains': 'domains',
  'sa-provisioning': 'provisioning',
  'sa-migration': 'migration',
};

/**
 * SA-20 — readiness signals, complaints and the self-diagnostic (D12/D13).
 *
 * The livid traffic-signal surface. Every readiness check is a deterministic verdict with a reason in
 * words; an unevaluated check is amber and says so, never green. Every non-green signal carries its
 * fix: a "Fix this" deep-link to the exact screen, a "Contact Super Admin" action that raises a coded
 * complaint with the whole issue attached, and a "Re-check" that runs that one signal in isolation.
 *
 * The complaint register below lists the coded issues, filters them, and records assignment,
 * comments and resolution (each with a reason).
 */
export const SuperAdminReadiness: React.FC<{ onNavigate?: (tab: string) => void }> = ({ onNavigate }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [targetOrg, setTargetOrg] = useState('');
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [admins, setAdmins] = useState<{ id: string; email: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last diagnostic result per signal, so a re-check shows what it found. */
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  /** The filter for the complaint register. */
  const [filter, setFilter] = useState<'all' | 'open' | 'assigned' | 'resolved'>('all');
  /** The complaint whose trail is open, and its events. */
  const [openTrail, setOpenTrail] = useState<string>('');
  const [trail, setTrail] = useState<ComplaintEvent[]>([]);
  const [resolveDraft, setResolveDraft] = useState<Record<string, string>>({});
  const [assignDraft, setAssignDraft] = useState<Record<string, string>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const loadTenants = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [rows, adminRows] = await Promise.all([listTenants(), listPlatformAdmins()]);
      setTenants(rows);
      setAdmins(adminRows);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the tenants.');
      setState('error');
    }
  }, []);

  useEffect(() => { void loadTenants(); }, [loadTenants]);

  const loadReport = useCallback(async () => {
    if (!targetOrg) { setReport(null); return; }
    try {
      const [rep, comps] = await Promise.all([platformReadiness(targetOrg), listComplaints(targetOrg)]);
      setReport(rep);
      setComplaints(comps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the readiness signals.');
      setReport(null);
    }
  }, [targetOrg]);

  useEffect(() => { void loadReport(); }, [loadReport]);

  const nonGreen = useMemo(
    () => (report?.signals ?? []).filter((s) => s.verdict !== 'green'),
    [report],
  );

  const visibleComplaints = useMemo(
    () => (filter === 'all' ? complaints : complaints.filter((c) => c.status === filter)),
    [complaints, filter],
  );

  const recheck = async (signal: ReadinessSignal) => {
    if (!targetOrg) return;
    setBusy(`diag-${signal.signalId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await runDiagnostic(targetOrg, signal.signalId);
      setDiagnostics((d) => ({
        ...d,
        [signal.signalId]: `${VERDICT_WORD[res.verdict]} — ${res.reason}${res.recorded ? ' (recorded)' : ''}`,
      }));
      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The diagnostic could not run.');
    }
    setBusy(null);
  };

  const contact = async (signal: ReadinessSignal) => {
    if (!targetOrg) return;
    setBusy(`complaint-${signal.signalId}`);
    setError(null);
    setNotice(null);
    const res = await createComplaint(
      targetOrg, `${signal.label}: ${signal.reason}`, [signal.signalId], signal.severity, signal.remediation,
    );
    if (!res.ok) setError(res.reason);
    else setNotice(`Complaint ${res.code} raised and emailed to the platform administrators.`);
    await loadReport();
    setBusy(null);
  };

  const openComplaintTrail = async (c: ComplaintRow) => {
    if (openTrail === c.id) { setOpenTrail(''); setTrail([]); return; }
    setOpenTrail(c.id);
    await loadTrail(c.id);
  };

  const loadTrail = async (complaintId: string) => {
    try {
      setTrail(await listComplaintEvents(complaintId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the complaint trail.');
      setTrail([]);
    }
  };

  const resolve = async (c: ComplaintRow) => {
    const reason = (resolveDraft[c.id] ?? '').trim();
    if (!reason) { setError('A reason is required to resolve a complaint.'); return; }
    setBusy(`resolve-${c.id}`);
    setError(null);
    setNotice(null);
    const res = await resolveComplaint(c.id, reason);
    if (!res.ok) setError(res.reason);
    else { setNotice(`Complaint ${c.code} resolved.`); setResolveDraft((d) => ({ ...d, [c.id]: '' })); }
    await loadReport();
    setBusy(null);
  };

  const assign = async (c: ComplaintRow) => {
    const assignee = (assignDraft[c.id] ?? '').trim();
    if (!assignee) { setError('Choose an administrator to assign the complaint to.'); return; }
    setBusy(`assign-${c.id}`);
    setError(null);
    setNotice(null);
    const res = await assignComplaint(c.id, assignee, 'assigned from the readiness register');
    if (!res.ok) setError(res.reason);
    else setNotice(`Complaint ${c.code} assigned.`);
    await loadReport();
    setBusy(null);
  };

  const comment = async (c: ComplaintRow) => {
    const body = (commentDraft[c.id] ?? '').trim();
    if (!body) { setError('A comment cannot be empty.'); return; }
    setBusy(`comment-${c.id}`);
    setError(null);
    setNotice(null);
    const res = await commentComplaint(c.id, body);
    if (!res.ok) setError(res.reason);
    else { setNotice(`Comment added to ${c.code}.`); setCommentDraft((d) => ({ ...d, [c.id]: '' })); }
    if (openTrail === c.id) await loadTrail(c.id);
    await loadReport();
    setBusy(null);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="sa-readiness-loading">Reading the readiness signals…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="sa-readiness-error" />
        <button type="button" onClick={() => void loadTenants()} className="text-apple-12 text-accent hover:underline" data-testid="sa-readiness-retry">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="sa-readiness">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" /> Readiness signals
        </h2>
        <p className="text-apple-12 text-secondary">
          Every check is a verdict with a reason. A check that cannot be evaluated is amber and says so
          — it is never green by default. Every signal that is not green carries its fix.
        </p>
      </header>

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-readiness-target">
        <h3 className="text-apple-13 font-semibold text-primary">Organisation</h3>
        <div className="flex flex-wrap gap-2">
          <select
            value={targetOrg} onChange={(e) => setTargetOrg(e.target.value)}
            aria-label="Target organisation" data-testid="sa-readiness-org-select"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          >
            <option value="">Choose an organisation…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            type="button" disabled={!targetOrg} onClick={() => void loadReport()}
            data-testid="sa-readiness-refresh"
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary"
          >
            <RefreshCw className="w-3.5 h-3.5 inline" /> Re-read
          </button>
        </div>
      </section>

      {targetOrg && report && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-readiness-signals">
          <div className="flex items-center justify-between">
            <h3 className="text-apple-13 font-semibold text-primary">Signals</h3>
            <p className="text-apple-12 text-secondary" data-testid="sa-readiness-summary">
              {report.summary.green} ready · {report.summary.amber} not evaluated · {report.summary.red} broken
            </p>
          </div>
          {report.signals.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="sa-readiness-empty">
              No signal is registered for this organisation.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.signals.map((s) => (
                <li key={s.signalId} className="rounded-xl border border-hairline bg-canvas p-3 space-y-1"
                    data-testid={`sa-readiness-signal-${s.signalId}`}>
                  <div className="flex items-center gap-2">
                    {s.verdict === 'green'
                      ? <Check className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />
                      : s.verdict === 'red'
                        ? <AlertCircle className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />
                        : <AlertTriangle className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />}
                    <span className="text-apple-12 font-medium text-primary">{s.label}</span>
                    <span className={`text-apple-11 ${VERDICT_STYLE[s.verdict]}`}
                          data-testid={`sa-readiness-verdict-${s.signalId}`}>
                      {VERDICT_WORD[s.verdict]}
                    </span>
                    <span className="text-apple-11 text-tertiary">· {s.layer}</span>
                  </div>
                  <p className="text-apple-11 text-secondary" data-testid={`sa-readiness-reason-${s.signalId}`}>{s.reason}</p>
                  {diagnostics[s.signalId] && (
                    <p className="text-apple-11 text-tertiary" data-testid={`sa-readiness-diag-${s.signalId}`}>
                      Re-check: {diagnostics[s.signalId]}
                    </p>
                  )}
                  {s.verdict !== 'green' && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <p className="text-apple-11 text-secondary flex-1 min-w-48">{s.remediation}</p>
                      {FIX_TABS[s.fixTarget] && onNavigate && (
                        <button
                          type="button" onClick={() => onNavigate(FIX_TABS[s.fixTarget])}
                          data-testid={`sa-readiness-fix-${s.signalId}`}
                          className="text-apple-11 text-accent hover:underline"
                        >
                          Fix this
                        </button>
                      )}
                      <button
                        type="button" disabled={busy !== null} onClick={() => void recheck(s)}
                        data-testid={`sa-readiness-recheck-${s.signalId}`}
                        className="text-apple-11 text-secondary hover:text-primary"
                      >
                        Re-check
                      </button>
                      <button
                        type="button" disabled={busy !== null} onClick={() => void contact(s)}
                        data-testid={`sa-readiness-contact-${s.signalId}`}
                        className="text-apple-11 text-cinnabar hover:underline"
                      >
                        Contact Super Admin
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {notice && <p className="text-apple-12 text-verdigris" data-testid="sa-readiness-notice">{notice}</p>}
          {error && <InlineError message={error} testId="sa-readiness-action-error" />}
        </section>
      )}

      {targetOrg && report && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-readiness-layers">
          <h3 className="text-apple-13 font-semibold text-primary">Deployment readiness — the three layers</h3>
          <p className="text-apple-11 text-secondary">
            The app is a static SPA; the environment is three separate deployments. Where a layer's status
            is not readable from the database the panel says so and points at the runbook — it never claims
            green on something it cannot see.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {(['platform', 'environment', 'organisation'] as const).map((layer) => {
              const inLayer = report.signals.filter((s) => s.layer === layer);
              const worst: ReadinessSignal['verdict'] = inLayer.some((s) => s.verdict === 'red')
                ? 'red' : inLayer.some((s) => s.verdict === 'amber') ? 'amber' : 'green';
              return (
                <div key={layer} className="rounded-xl border border-hairline bg-canvas p-3 space-y-1"
                     data-testid={`sa-readiness-layer-${layer}`}>
                  <h4 className="text-apple-12 font-medium text-primary capitalize">{layer}</h4>
                  <p className={`text-apple-11 ${VERDICT_STYLE[worst]}`}
                     data-testid={`sa-readiness-layer-verdict-${layer}`}>
                    {VERDICT_WORD[worst]}
                  </p>
                  <p className="text-apple-11 text-secondary">
                    {inLayer.filter((s) => s.verdict === 'green').length} of {inLayer.length} ready
                  </p>
                  {layer === 'environment' && (
                    <p className="text-apple-11 text-tertiary" data-testid="sa-readiness-runbook-note">
                      Verify at the host; see docs/DEPLOYMENT-RUNBOOK.md.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {targetOrg && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="complaints">
          <div className="flex items-center justify-between">
            <h3 className="text-apple-13 font-semibold text-primary">Complaints</h3>
            <select
              value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}
              aria-label="Filter complaints" data-testid="complaints-filter"
              className="rounded-xl border border-hairline bg-canvas px-3 py-1.5 text-apple-12"
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
          {visibleComplaints.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="complaints-empty">
              No complaint matches this filter.
            </p>
          ) : (
            <ul className="space-y-2">
              {visibleComplaints.map((c) => (
                <li key={c.id} className="rounded-xl border border-hairline bg-canvas p-3 space-y-1"
                    data-testid={`complaint-${c.code}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-apple-12 font-medium text-primary" data-testid={`complaint-code-${c.code}`}>{c.code}</span>
                    <span className={`text-apple-11 ${c.severity === 'critical' ? 'text-cinnabar' : 'text-brass'}`}>{c.severity}</span>
                    <span className="text-apple-11 text-tertiary">{c.status}</span>
                    <button
                      type="button" onClick={() => void openComplaintTrail(c)}
                      data-testid={`complaint-trail-${c.code}`}
                      className="text-apple-11 text-accent hover:underline ml-auto"
                    >
                      Trail
                    </button>
                  </div>
                  <p className="text-apple-12 text-secondary">{c.title}</p>
                  {c.resolutionReason && (
                    <p className="text-apple-11 text-verdigris">Resolved: {c.resolutionReason}</p>
                  )}
                  {openTrail === c.id && (
                    <ul className="text-apple-11 text-secondary space-y-0.5" data-testid={`complaint-events-${c.code}`}>
                      {trail.map((e, i) => <li key={i}>• {e.kind}</li>)}
                    </ul>
                  )}
                  {c.status !== 'resolved' && (
                    <div className="space-y-1 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={assignDraft[c.id] ?? ''}
                          onChange={(e) => setAssignDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                          aria-label="Assign to" data-testid={`complaint-assign-${c.code}`}
                          className="rounded-xl border border-hairline bg-surface px-3 py-1.5 text-apple-12"
                        >
                          <option value="">Assign to…</option>
                          {admins.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                        </select>
                        <input
                          type="text" value={commentDraft[c.id] ?? ''}
                          onChange={(e) => setCommentDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                          placeholder="Add a comment" aria-label="Comment"
                          data-testid={`complaint-comment-${c.code}`}
                          className="flex-1 min-w-40 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-apple-12"
                        />
                        <button
                          type="button" disabled={busy !== null} onClick={() => void comment(c)}
                          data-testid={`complaint-comment-send-${c.code}`}
                          className="px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
                        >
                          Comment
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text" value={resolveDraft[c.id] ?? ''}
                          onChange={(e) => setResolveDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                          placeholder="Resolution reason (required)" aria-label="Resolution reason"
                          data-testid={`complaint-resolve-reason-${c.code}`}
                          className="flex-1 min-w-48 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-apple-12"
                        />
                        <button
                          type="button" disabled={busy !== null} onClick={() => void assign(c)}
                          data-testid={`complaint-assign-save-${c.code}`}
                          className="px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
                        >
                          Assign
                        </button>
                        <button
                          type="button" disabled={busy !== null} onClick={() => void resolve(c)}
                          data-testid={`complaint-resolve-${c.code}`}
                          className="px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-apple-11 text-tertiary" data-testid="complaints-admin-count">
            <Send className="w-3 h-3 inline" /> {admins.length} platform administrator{admins.length === 1 ? '' : 's'} will receive a complaint.
          </p>
        </section>
      )}
    </div>
  );
};
