import React, { Suspense, lazy, useState } from 'react';
import { useOptionalLive } from '../../context/liveContext';
import { renderReport } from '../../lib/reporting/report';

// Every export renders nothing in demo mode, so demo screens are unchanged there.
const ProcurementWorkspace = lazy(() => import('./ProcurementWorkspace').then((m) => ({ default: m.ProcurementWorkspace })));
const button = 'rounded-lg border border-hairline bg-surface px-3 py-2 text-primary disabled:opacity-50';

function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Top strip in live mode: connection status, sign-out, retry/error for the authenticated side. */
export function LiveBanner() {
  const live = useOptionalLive();
  const [err, setErr] = useState('');
  if (!live) return null;
  return (
    <div className="px-6 py-2 bg-surface border-b border-hairline text-apple-12 flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-secondary">
        Live · Supabase (authenticated, scoped). Procurement audits and issued reports are real records. Other tabs show synthetic demo data and are labelled.
      </p>
      <div className="flex items-center gap-3">
        {live.retryAvailable && (
          <button className={button} disabled={live.busy} onClick={() => live.retry().catch((e) => setErr(e.message))}>Retry last command</button>
        )}
        <button className={button} onClick={() => live.signOut().catch((e) => setErr(e.message))}>Sign out</button>
      </div>
      {(err || live.error) && <p role="alert" className="w-full text-cinnabar">{err || live.error}</p>}
    </div>
  );
}

/** Audit File tab: the real procurement workspace, above the synthetic demo engagements. */
export function LiveAuditSection() {
  const live = useOptionalLive();
  if (!live) return null;
  return (
    <div className="space-y-3" data-testid="live-audit-section">
      <h2 className="font-serif-title text-apple-20 font-bold text-primary">Live procurement audits (Supabase)</h2>
      <Suspense fallback={<p>Loading live audits…</p>}><ProcurementWorkspace /></Suspense>
      <hr className="border-hairline" />
      <h2 className="font-serif-title text-apple-20 font-bold text-primary">Synthetic demo engagements</h2>
    </div>
  );
}

/** Issues Register: only issued reports from the live database. */
export function LiveIssuedReports() {
  const live = useOptionalLive();
  if (!live) return null;
  const issued = live.snapshot.issued;
  return (
    <div className="space-y-3" data-testid="live-issued">
      <h2 className="font-serif-title text-apple-20 font-bold text-primary">Live issued reports (Supabase)</h2>
      {issued.length === 0 && <p className="text-secondary">No issued reports yet. Issues appear here only after a CIA issues a report.</p>}
      {issued.map((a) => (
        <article key={a.id} className="rounded-xl border border-hairline p-4 space-y-2">
          <h3>{a.report.title}</h3>
          <button className={button} onClick={() => saveText(`report-${a.report.id}.txt`, renderReport(a.report as never))}>Download issued report</button>
          {a.issues.map((i) => <p key={i.id}>{i.severity} · {i.condition} · {i.status}</p>)}
        </article>
      ))}
      <hr className="border-hairline" />
      <h2 className="font-serif-title text-apple-20 font-bold text-primary">Synthetic demo issues</h2>
    </div>
  );
}

/** Executive Summary: live counts above the demo cockpit. */
export function LiveSummary() {
  const live = useOptionalLive();
  if (!live) return null;
  const all = live.snapshot.issued.flatMap((a) => a.issues);
  return (
    <div className="max-w-7xl mx-auto px-6 pt-6" data-testid="live-summary">
      <h2 className="font-serif-title text-apple-20 font-bold text-primary">Live (Supabase)</h2>
      <p className="text-secondary">
        {live.snapshot.cases.length} audit cases · {live.snapshot.issued.length} issued reports · {all.filter((i) => i.status !== 'closed').length} unresolved issues · {all.filter((i) => i.status === 'closed').length} independently validated closures. The cockpit below is synthetic demo data.
      </p>
    </div>
  );
}
