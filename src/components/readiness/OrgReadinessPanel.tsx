import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createOrgComplaint, listOrgComplaints, orgReadiness, resolveComplaint, runOrgDiagnostic,
  type ComplaintRow, type ReadinessReport, type ReadinessSignal,
} from '../../data/readiness';
import { InlineError } from '../common/InlineError';
import { Check, AlertTriangle, AlertCircle, RefreshCw, Shield } from '../common/Icons';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';

type LoadState = 'loading' | 'ready' | 'error';

const VERDICT_STYLE: Record<ReadinessSignal['verdict'], string> = {
  green: 'text-verdigris', amber: 'text-brass', red: 'text-cinnabar',
};

const VERDICT_WORD: Record<ReadinessSignal['verdict'], string> = {
  green: 'Ready', amber: 'Not evaluated', red: 'Broken',
};

/**
 * The organisation readiness and complaint surface (D12, docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md).
 *
 * The tenant half of the traffic-signal work: the same verdicts for the organisation's own checks, a
 * self-diagnostic per signal, and the complaint register for this organisation. The environment
 * signals are the platform's and are never shown here (L2) — this panel reads only the org view.
 *
 * A signal that is not green carries its fix and a "Contact Super Admin" action, which raises a coded
 * complaint and emails the platform administrators. Raising a complaint needs the edit_config right,
 * which the database re-checks; the panel surfaces the refusal with its exact reason.
 */
export const OrgReadinessPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canRaise = hasRight(currentUser, 'edit_config');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const [resolveDraft, setResolveDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [rep, comps] = await Promise.all([orgReadiness(), listOrgComplaints()]);
      setReport(rep);
      setComplaints(comps);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read the readiness signals.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const nonGreen = useMemo(() => (report?.signals ?? []).filter((s) => s.verdict !== 'green'), [report]);

  const recheck = async (s: ReadinessSignal) => {
    setBusy(`diag-${s.signalId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await runOrgDiagnostic(s.signalId);
      setDiagnostics((d) => ({ ...d, [s.signalId]: `${VERDICT_WORD[res.verdict]} — ${res.reason}` }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The diagnostic could not run.');
    }
    setBusy(null);
  };

  const contact = async (s: ReadinessSignal) => {
    setBusy(`complaint-${s.signalId}`);
    setError(null);
    setNotice(null);
    const res = await createOrgComplaint(
      `${s.label}: ${s.reason}`, [s.signalId], s.severity, s.remediation,
    );
    if (!res.ok) setError(res.reason);
    else setNotice(`Complaint ${res.code} raised and sent to the platform administrators.`);
    await load();
    setBusy(null);
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
    await load();
    setBusy(null);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="org-readiness-loading">Reading the readiness signals…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="org-readiness-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline" data-testid="org-readiness-retry">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="org-readiness">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" /> Readiness
        </h2>
        <p className="text-apple-12 text-secondary">
          What is ready, what is not evaluated and what is broken — each with its reason. A check that
          cannot be evaluated is amber and says so, never green.
        </p>
      </header>

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="org-readiness-signals">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary">Signals</h3>
          <div className="flex items-center gap-3">
            {report && (
              <p className="text-apple-12 text-secondary" data-testid="org-readiness-summary">
                {report.summary.green} ready · {report.summary.amber} not evaluated · {report.summary.red} broken
              </p>
            )}
            <button
              type="button" onClick={() => void load()} data-testid="org-readiness-refresh"
              className="text-apple-12 text-secondary hover:text-primary"
            >
              <RefreshCw className="w-3.5 h-3.5 inline" /> Re-read
            </button>
          </div>
        </div>
        {nonGreen.length === 0 && (report?.signals.length ?? 0) > 0 && (
          <p className="text-apple-12 text-verdigris" data-testid="org-readiness-all-clear">
            Every organisation check is ready.
          </p>
        )}
        <ul className="space-y-2">
          {(report?.signals ?? []).map((s) => (
            <li key={s.signalId} className="rounded-xl border border-hairline bg-canvas p-3 space-y-1"
                data-testid={`org-readiness-signal-${s.signalId}`}>
              <div className="flex items-center gap-2">
                {s.verdict === 'green'
                  ? <Check className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />
                  : s.verdict === 'red'
                    ? <AlertCircle className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />
                    : <AlertTriangle className={`w-4 h-4 ${VERDICT_STYLE[s.verdict]}`} />}
                <span className="text-apple-12 font-medium text-primary">{s.label}</span>
                <span className={`text-apple-11 ${VERDICT_STYLE[s.verdict]}`}
                      data-testid={`org-readiness-verdict-${s.signalId}`}>
                  {VERDICT_WORD[s.verdict]}
                </span>
              </div>
              <p className="text-apple-11 text-secondary" data-testid={`org-readiness-reason-${s.signalId}`}>{s.reason}</p>
              {diagnostics[s.signalId] && (
                <p className="text-apple-11 text-tertiary" data-testid={`org-readiness-diag-${s.signalId}`}>
                  Re-check: {diagnostics[s.signalId]}
                </p>
              )}
              {s.verdict !== 'green' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <p className="text-apple-11 text-secondary flex-1 min-w-48">{s.remediation}</p>
                  <button
                    type="button" disabled={busy !== null} onClick={() => void recheck(s)}
                    data-testid={`org-readiness-recheck-${s.signalId}`}
                    className="text-apple-11 text-secondary hover:text-primary"
                  >
                    Re-check
                  </button>
                  <button
                    type="button" disabled={busy !== null || !canRaise} onClick={() => void contact(s)}
                    data-testid={`org-readiness-contact-${s.signalId}`}
                    className="text-apple-11 text-cinnabar hover:underline disabled:opacity-40"
                  >
                    Contact Super Admin
                  </button>
                  {!canRaise && (
                    <span className="text-apple-11 text-tertiary" data-testid={`org-readiness-contact-readonly-${s.signalId}`}>
                      Raising a complaint needs the edit_config right.
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {notice && <p className="text-apple-12 text-verdigris" data-testid="org-readiness-notice">{notice}</p>}
        {error && <InlineError message={error} testId="org-readiness-action-error" />}
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="org-complaints">
        <h3 className="text-apple-13 font-semibold text-primary">Our complaints</h3>
        {complaints.length === 0 ? (
          <p className="text-apple-12 text-secondary" data-testid="org-complaints-empty">
            No complaint has been raised for this organisation.
          </p>
        ) : (
          <ul className="space-y-2">
            {complaints.map((c) => (
              <li key={c.id} className="rounded-xl border border-hairline bg-canvas p-3 space-y-1"
                  data-testid={`org-complaint-${c.code}`}>
                <div className="flex items-center gap-2">
                  <span className="text-apple-12 font-medium text-primary">{c.code}</span>
                  <span className={`text-apple-11 ${c.severity === 'critical' ? 'text-cinnabar' : 'text-brass'}`}>{c.severity}</span>
                  <span className="text-apple-11 text-tertiary">{c.status}</span>
                </div>
                <p className="text-apple-12 text-secondary">{c.title}</p>
                {c.resolutionReason && <p className="text-apple-11 text-verdigris">Resolved: {c.resolutionReason}</p>}
                {c.status !== 'resolved' && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      type="text" value={resolveDraft[c.id] ?? ''}
                      onChange={(e) => setResolveDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      placeholder="Resolution reason (required)" aria-label="Resolution reason"
                      data-testid={`org-complaint-resolve-reason-${c.code}`}
                      className="flex-1 min-w-48 rounded-xl border border-hairline bg-surface px-3 py-1.5 text-apple-12"
                    />
                    <button
                      type="button" disabled={busy !== null || !canRaise} onClick={() => void resolve(c)}
                      data-testid={`org-complaint-resolve-${c.code}`}
                      className="px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
                    >
                      Resolve
                    </button>
                    {!canRaise && (
                      <span className="text-apple-11 text-tertiary" data-testid={`org-complaint-resolve-readonly-${c.code}`}>
                        Resolving needs the edit_config right.
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
