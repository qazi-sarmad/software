import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listRows,
  getWorkpaper,
  recordRow,
  signOffWorkpaper,
  reopenWorkpaper,
  type WorkpaperRowRow,
  type RowResult,
} from '../../data/rowTesting';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { Check, X, AlertTriangle, ShieldCheck, Lock, RotateCcw } from '../common/Icons';

const RESULTS: { id: RowResult; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'tick', label: 'Tick', icon: Check },
  { id: 'cross', label: 'Cross', icon: X },
  { id: 'unverifiable', label: 'Unverifiable', icon: AlertTriangle },
];

/**
 * Workpaper row testing panel (4I, spec §11.3, §11.4). A table of sample rows with tick/cross/
 * unverifiable controls, an exception flag, a rationale that is required for cross and unverifiable,
 * row status chips and a sign-off button whose pre-flight lists any incomplete rows. Non-blocking.
 */
export const RowTestingPanel: React.FC<{ workpaperId: string }> = ({ workpaperId }) => {
  const { currentUser } = useApp();
  const [rows, setRows] = useState<WorkpaperRowRow[]>([]);
  const [status, setStatus] = useState<string>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, { rationale: string; exception: boolean }>>({});
  const [justification, setJustification] = useState('');

  const canWrite = hasRight(currentUser, 'perform_work');
  const canReview = hasRight(currentUser, 'review_and_approve');
  const canReopen = hasRight(currentUser, 'can_reopen');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rs, wp] = await Promise.all([listRows(workpaperId), getWorkpaper(workpaperId)]);
      setRows(rs);
      if (wp) setStatus(wp.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load workpaper rows.');
    } finally {
      setLoading(false);
    }
  }, [workpaperId]);

  useEffect(() => {
    void load();
  }, [load]);

  const incomplete = rows.filter(
    (r) => !r.result || ((r.result === 'cross' || r.result === 'unverifiable') && !r.rationale)
  );

  const setResult = async (row: WorkpaperRowRow, result: RowResult) => {
    const d = draft[row.rowRef] ?? { rationale: '', exception: false };
    const needsRationale = result === 'cross' || result === 'unverifiable';
    if (needsRationale && d.rationale.trim().length === 0) {
      setError(`Row ${row.rowRef}: a rationale is required for "${result}".`);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await recordRow(workpaperId, row.rowRef, result, d.rationale || undefined, d.exception);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const sign = async () => {
    setBusy(true);
    setError(null);
    const res = await signOffWorkpaper(workpaperId);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const reopen = async () => {
    setBusy(true);
    setError(null);
    const res = await reopenWorkpaper(workpaperId, justification.trim());
    if (!res.ok) setError(res.reason);
    else {
      setJustification('');
      await load();
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="rowtesting-loading" />;
  }

  const signedOff = status === 'signed_off';

  return (
    <div className="space-y-5" data-testid="rowtesting-panel">
      <InlineError message={error} testId="rowtesting-error" />

      {rows.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="rowtesting-empty">
          No sample rows are recorded for this working paper yet. Compute and lock a sample first.
        </div>
      ) : (
        <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
          <table className="w-full text-apple-12">
            <thead className="bg-surface-sunken text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Row</th>
                <th className="text-left px-3 py-2 font-semibold">Result</th>
                <th className="text-left px-3 py-2 font-semibold">Rationale</th>
                <th className="text-left px-3 py-2 font-semibold">Exception</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((r) => {
                const d = draft[r.rowRef] ?? { rationale: r.rationale ?? '', exception: r.exceptionFlag };
                return (
                  <tr key={r.id} data-testid={`rowtesting-row-${r.rowRef}`}>
                    <td className="px-3 py-2 font-mono text-primary">{r.rowRef}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {RESULTS.map(({ id, label, icon: Icon }) => (
                          <button
                            key={id}
                            type="button"
                            data-testid={`rowtesting-${id}-${r.rowRef}`}
                            disabled={!canWrite || signedOff || busy}
                            onClick={() => setResult(r, id)}
                            title={label}
                            className={`px-2 py-1 rounded-lg border text-apple-11 font-semibold flex items-center gap-1 disabled:opacity-40 ${
                              r.result === id ? 'border-accent text-primary bg-surface-hover' : 'border-hairline text-secondary'
                            }`}
                          >
                            <Icon className="w-3 h-3" /> {label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        data-testid={`rowtesting-rationale-${r.rowRef}`}
                        value={d.rationale}
                        disabled={!canWrite || signedOff}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [r.rowRef]: { ...d, rationale: e.target.value } }))}
                        rows={1}
                        className="w-full px-2 py-1 rounded-lg bg-surface-sunken border border-hairline text-apple-11 text-primary"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        data-testid={`rowtesting-exception-${r.rowRef}`}
                        checked={d.exception}
                        disabled={!canWrite || signedOff}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [r.rowRef]: { ...d, exception: e.target.checked } }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        data-testid={`rowtesting-status-${r.rowRef}`}
                        className={`px-2 py-0.5 rounded text-apple-11 font-semibold border ${
                          r.result ? 'bg-verdigris-subtle border-verdigris text-verdigris' : 'bg-surface-sunken border-hairline text-secondary'
                        }`}
                      >
                        {r.result ?? 'pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sign-off pre-flight */}
      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-2">
        <div className="text-apple-13 font-semibold text-primary">Sign-off</div>
        {signedOff ? (
          <div className="space-y-2">
            <div className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-2" data-testid="rowtesting-signed-off">
              <ShieldCheck className="w-4 h-4" /> This working paper is sealed and read-only.
            </div>
            {canReopen && (
              <div className="space-y-2">
                <label className="block text-apple-11 text-secondary" htmlFor="rowtesting-justification">
                  Reopen justification (min 10 characters)
                </label>
                <textarea
                  id="rowtesting-justification"
                  data-testid="rowtesting-justification"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
                />
                <button
                  type="button"
                  data-testid="rowtesting-reopen"
                  onClick={reopen}
                  disabled={busy || justification.trim().length < 10}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {incomplete.length > 0 && (
              <div className="px-3 py-2 rounded-xl text-apple-12 text-cinnabar bg-cinnabar-subtle border border-cinnabar" data-testid="rowtesting-preflight">
                {incomplete.length} row{incomplete.length === 1 ? '' : 's'} incomplete:{' '}
                {incomplete.map((r) => r.rowRef).join(', ')}
              </div>
            )}
            <HoldToConfirm
              label="Sign off and seal working paper"
              testId="rowtesting-signoff"
              durationMs={2000}
              onConfirm={sign}
              disabled={busy || !canReview || rows.length === 0 || incomplete.length > 0}
              title={!canReview ? rightReason('review_and_approve') : undefined}
              className="relative overflow-hidden px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Lock className="w-4 h-4" /> Sign off and seal working paper
            </HoldToConfirm>
            {!canReview && (
              <div className="text-apple-11 text-secondary" data-testid="rowtesting-signoff-reason">
                {rightReason('review_and_approve')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
