import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  populateSuggestions,
  decideSuggestion,
  checkReconciliation,
  acknowledgeDiscrepancy,
  signPlanning,
  isPlanningSignedOff,
  type PlanningSuggestion,
} from '../../data/planning';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { PriorYearImportPanel } from './PriorYearImportPanel';
import { AlertTriangle, CheckCircle2, ShieldCheck, Lock, RefreshCw } from '../common/Icons';

/**
 * Planning tab (4I, spec §10, §11). SIRA pre-fill suggestions per risk with Accept/Reject/Edit, a
 * reconciliation banner, and a sign-off button that stays disabled with an inline reason while the
 * reconciliation gate is unmet. Every write goes through the 4B RPCs; the database decides the right.
 */
export const PlanningPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser, rawEngagements } = useApp();
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<boolean | null>(null);
  const [signedOff, setSignedOff] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const canSign = hasRight(currentUser, 'review_and_approve');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sugs, rec, so] = await Promise.all([
        populateSuggestions(engagementId),
        checkReconciliation(engagementId),
        isPlanningSignedOff(engagementId),
      ]);
      setSuggestions(sugs);
      setReconciled(rec);
      setSignedOff(so);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load planning suggestions.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (s: PlanningSuggestion, accepted: boolean) => {
    setBusy(true);
    setError(null);
    const res = await decideSuggestion(engagementId, s.suggestionId, accepted, accepted ? undefined : reason || undefined);
    if (!res.ok) setError(res.reason);
    else setSuggestions((prev) => prev.filter((x) => x.suggestionId !== s.suggestionId));
    setBusy(false);
  };

  const ack = async () => {
    if (reason.trim().length < 10) {
      setError('A discrepancy acknowledgement needs a reason of at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await acknowledgeDiscrepancy(engagementId, reason.trim());
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const sign = async () => {
    setBusy(true);
    setError(null);
    const res = await signPlanning(engagementId);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  if (loading) {
    return (
      <div className="space-y-3" data-testid="planning-loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="planning-panel">
      {/* Reconciliation banner */}
      <div
        data-testid="planning-reconciliation"
        className={`p-4 rounded-2xl border flex items-start gap-3 ${
          reconciled
            ? 'bg-verdigris-subtle border-verdigris'
            : 'bg-cinnabar-subtle border-cinnabar'
        }`}
      >
        {reconciled ? (
          <CheckCircle2 className="w-4 h-4 text-verdigris mt-0.5 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-cinnabar mt-0.5 shrink-0" />
        )}
        <div className="flex-1 space-y-1">
          <div className="text-apple-13 font-semibold text-primary">
            {reconciled ? 'Planning reconciles with the latest SIRA cycle' : 'Planning does not reconcile with the latest SIRA cycle'}
          </div>
          <p className="text-apple-12 text-secondary">
            {reconciled
              ? 'Every risk in the planning RCM matches a risk in the latest SIRA cycle.'
              : 'Every risk in the planning RCM must match a risk in the latest SIRA cycle before sign-off, or the discrepancy must be acknowledged with a recorded reason.'}
          </p>
          {!reconciled && (
            <div className="pt-2 space-y-2">
              <label className="block text-apple-11 text-secondary" htmlFor="planning-ack-reason">
                Acknowledgement reason (min 10 characters)
              </label>
              <textarea
                id="planning-ack-reason"
                data-testid="planning-ack-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <button
                type="button"
                data-testid="planning-ack"
                onClick={ack}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
              >
                Record acknowledgement
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4 stroke-[1.5]" />
        </button>
      </div>

      <InlineError message={error} testId="planning-error" />

      {/* SIRA pre-fill suggestions */}
      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          SIRA pre-fill suggestions ({suggestions.length})
        </h3>
        {suggestions.length === 0 ? (
          <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="planning-suggestions-empty">
            No SIRA suggestions are available. Either no SIRA cycle is published for this entity, or every
            suggestion has been decided.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((s) => (
              <div key={s.suggestionId} className="p-4 rounded-2xl bg-surface-elevated border border-hairline space-y-2" data-testid={`suggestion-${s.suggestionId}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-apple-11 font-bold text-secondary">{s.riskId}</span>
                  {s.riskBand && (
                    <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-surface border border-hairline text-secondary capitalize">
                      {s.riskBand}
                    </span>
                  )}
                </div>
                <div className="text-apple-12 text-secondary">
                  Inherent: <span className="text-primary font-medium">{String(s.inherentRating ?? '—')}</span> · Prior findings:{' '}
                  <span className="text-primary font-medium tabular-nums">{s.priorFindingCount}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid={`suggestion-accept-${s.suggestionId}`}
                    onClick={() => decide(s, true)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-verdigris-subtle border border-verdigris text-apple-12 font-semibold text-verdigris disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    data-testid={`suggestion-reject-${s.suggestionId}`}
                    onClick={() => decide(s, false)}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg bg-surface border border-hairline text-apple-12 font-semibold text-secondary disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Prior-year material (7G, §9.1): imported items do not count toward sign-off until confirmed. */}
      <PriorYearImportPanel
        engagementId={engagementId}
        sourceEngagements={rawEngagements
          .filter((e) => e.id !== engagementId)
          .map((e) => ({ id: e.id, label: `${e.title} (${e.periodEnd.slice(0, 4)})` }))}
      />

      {/* Sign-off */}
      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-2">
        <div className="text-apple-13 font-semibold text-primary">Planning sign-off</div>
        {signedOff ? (
          <div className="px-3 py-2 rounded-xl text-apple-12 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-2" data-testid="planning-signed-off">
            <ShieldCheck className="w-4 h-4" /> Planning is signed off. Testing is unlocked.
          </div>
        ) : (
          <>
            <HoldToConfirm
              label="Sign off planning"
              testId="planning-signoff"
              durationMs={2000}
              onConfirm={sign}
              disabled={!reconciled || !canSign || busy}
              title={!canSign ? rightReason('review_and_approve') : !reconciled ? 'Reconciliation gate is unmet.' : undefined}
              className="relative overflow-hidden px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Lock className="w-4 h-4" /> Sign off planning
            </HoldToConfirm>
            {!canSign && (
              <div className="text-apple-11 text-secondary" data-testid="planning-signoff-reason">
                {rightReason('review_and_approve')}
              </div>
            )}
            {canSign && !reconciled && (
              <div className="text-apple-11 text-secondary" data-testid="planning-signoff-reason">
                Sign-off is blocked until the reconciliation gate passes or the discrepancy is acknowledged.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
