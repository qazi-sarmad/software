import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { decideProposal, listEscalations, listProposals, type EscalationEvent, type WorkQueueProposal } from '../../data/escalation';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Check, X } from '../common/Icons';

/**
 * WK-08 escalation cards and proposals (F12).
 *
 * Escalations the caller's roles are targeted by, and the Work Queue proposals they can convert. The
 * recommendation shown is the deterministic one the rule decided; an "Explain anomaly" AI note may
 * sit beside it, labelled, and never changes it (L1, F8).
 */
export const EscalationCards: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const [escalations, setEscalations] = useState<EscalationEvent[]>([]);
  const [proposals, setProposals] = useState<WorkQueueProposal[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [e, p] = await Promise.all([listEscalations(orgId), listProposals(orgId)]);
      setEscalations(e);
      setProposals(p);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the escalations.');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (p: WorkQueueProposal, status: 'converted' | 'dismissed') => {
    setBusy(true);
    setResult(null);
    const r = await decideProposal(p.id, status);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const openProposals = proposals.filter((p) => p.status === 'proposed');
  if (!escalations.length && !openProposals.length && !error) return null;

  return (
    <div className="rounded-2xl bg-surface border border-hairline shadow-apple p-5 space-y-3" data-testid="wk-escalation">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-cinnabar" />
        <h2 className="text-apple-15 font-semibold text-primary">Escalations for you</h2>
      </div>
      {error && <InlineError message={error} testId="wk-escalation-error" />}
      {result && !result.ok && (
        <div className="text-apple-12 text-cinnabar" data-testid="wk-escalation-result">{result.reason}</div>
      )}

      {openProposals.length > 0 && (
        <ul className="divide-y divide-hairline" data-testid="wk-proposal-list">
          {openProposals.map((p) => (
            <li key={p.id} className="py-3 space-y-1" data-testid={`wk-proposal-${p.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-apple-13 font-medium text-primary">{p.title}</span>
                <span className="text-apple-11 text-tertiary">Work Queue proposal</span>
              </div>
              <p className="text-apple-12 text-secondary">{p.body}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(p, 'converted')}
                  data-testid={`wk-proposal-convert-${p.id}`}
                  className="inline-flex items-center gap-1 text-apple-12 text-accent hover:underline disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Start a plan
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(p, 'dismissed')}
                  data-testid={`wk-proposal-dismiss-${p.id}`}
                  className="inline-flex items-center gap-1 text-apple-12 text-secondary hover:text-primary disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" /> Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {escalations.length > 0 && (
        <ul className="divide-y divide-hairline" data-testid="wk-escalation-list">
          {escalations.map((e) => (
            <li key={e.id} className="py-3" data-testid={`wk-escalation-${e.id}`}>
              <div className="text-apple-13 text-primary">
                <span className="font-semibold">Audit required: {e.recommendation}</span>
                <span className="text-secondary"> — {e.reason}</span>
              </div>
              <div className="text-apple-11 text-tertiary">From {e.sourceEventKey}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
