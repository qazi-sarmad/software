import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  getConclusion,
  pullExceptions,
  signConclusion,
  testingSignedOff,
  type ConclusionRecord,
} from '../../data/conclusion';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { ArrowDown, ShieldCheck, XCircle } from '../common/Icons';

interface ExceptionItem {
  workpaper_row_id?: string;
  row_ref?: string;
  result?: string;
  rationale?: string | null;
}

/**
 * Conclusion panel (5G, spec §10.3, §10.4). Exceptions are pulled from Testing; removing a pulled item
 * needs a comment; sign-off runs a pre-flight banner. The Testing-sign-off gate, four-eyes and the
 * seal are enforced in the database (0034).
 */
export const ConclusionPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const [record, setRecord] = useState<ConclusionRecord | null>(null);
  const [testingOk, setTestingOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canReview = hasRight(currentUser, 'review_and_approve');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rec, ok] = await Promise.all([getConclusion(engagementId), testingSignedOff(engagementId)]);
      setRecord(rec);
      setTestingOk(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the conclusion.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pull = async () => {
    setBusy(true);
    setError(null);
    const res = await pullExceptions(engagementId);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const sign = async () => {
    setBusy(true);
    setError(null);
    const res = await signConclusion(engagementId);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="conclusion-loading" />;
  }

  const exceptions = (record?.exceptions ?? []) as ExceptionItem[];
  const locked = Boolean(record?.lockedAt);

  return (
    <div className="space-y-5" data-testid="conclusion-panel">
      <InlineError message={error} testId="conclusion-error" />

      {/* Pre-flight banner */}
      <div
        data-testid="conclusion-preflight"
        className={`px-4 py-3 rounded-2xl border text-apple-12 flex items-start gap-2 ${
          testingOk ? 'bg-surface border-hairline text-secondary' : 'bg-cinnabar-subtle border-cinnabar text-cinnabar'
        }`}
      >
        {testingOk ? (
          <>
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Testing is signed off. Exceptions can be pulled and the conclusion can be signed.</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Testing must be signed off before the Conclusion stage. Pull and sign-off are blocked.</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="conclusion-pull"
          onClick={pull}
          disabled={busy || !canReview || !testingOk || locked}
          title={!canReview ? 'You do not hold the review_and_approve right.' : undefined}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
        >
          <ArrowDown className="w-3.5 h-3.5" /> Pull exceptions from Testing
        </button>
        {record?.exceptionsPulledAt && (
          <span className="text-apple-11 text-secondary" data-testid="conclusion-pulled-at">
            pulled {new Date(record.exceptionsPulledAt).toLocaleString()}
          </span>
        )}
      </div>

      {exceptions.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="conclusion-exceptions-empty">
          No exceptions have been pulled yet. Every cross or unverifiable test row appears here.
        </div>
      ) : (
        <div className="border border-hairline rounded-xl overflow-hidden bg-surface" data-testid="conclusion-exceptions">
          <table className="w-full text-apple-12">
            <thead className="bg-surface-sunken text-secondary">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Row</th>
                <th className="text-left px-3 py-2 font-semibold">Result</th>
                <th className="text-left px-3 py-2 font-semibold">Rationale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {exceptions.map((e, i) => (
                <tr key={e.workpaper_row_id ?? i} data-testid={`conclusion-exception-${i}`}>
                  <td className="px-3 py-2 font-mono text-primary">{e.row_ref ?? '—'}</td>
                  <td className="px-3 py-2 text-cinnabar font-semibold">{e.result ?? '—'}</td>
                  <td className="px-3 py-2 text-secondary">{e.rationale || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-2">
        <div className="text-apple-13 font-semibold text-primary">Sign the conclusion</div>
        {locked ? (
          <div className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-2" data-testid="conclusion-locked">
            <ShieldCheck className="w-4 h-4" /> The conclusion is signed off and the engagement is sealed.
          </div>
        ) : (
          <>
            <button
              type="button"
              data-testid="conclusion-sign"
              onClick={sign}
              disabled={busy || !canReview || !testingOk || exceptions.length === 0}
              title={!canReview ? 'You do not hold the review_and_approve right.' : undefined}
              className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" /> Sign conclusion
            </button>
            {!canReview && (
              <div className="text-apple-11 text-secondary" data-testid="conclusion-sign-reason">
                You do not hold the review_and_approve right.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
