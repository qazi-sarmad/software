import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import {
  decideEntity,
  entityHistory,
  submitEntity,
  type EntityHistoryEntry,
  type EntityRow,
} from '../../data/universe';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { CheckCircle2, Clock, History, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Entity approval flow (spec §6). Renders inside the sliding inspector; the decision is a panel, not
 * a blocking modal. Every action is gated by a right (hasRight), and the write is re-checked in the
 * database by submit_entity / decide_entity.
 */
export const EntityApprovalPanel: React.FC<{ entity: EntityRow; onDone?: () => void }> = ({ entity, onDone }) => {
  const { currentUser } = useApp();
  const canSubmit = hasRight(currentUser, 'perform_work') || hasRight(currentUser, 'manage_engagements');
  const canDecide = hasRight(currentUser, 'approve_plan') || hasRight(currentUser, 'review_and_approve');

  const [status, setStatus] = useState<EntityRow['status']>(entity.status);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<EntityHistoryEntry[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      setHistory(await entityHistory(entity.id));
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The entity history could not be loaded.');
      setState('error');
    }
  }, [entity.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>, next: EntityRow['status']) => {
    setError(null);
    const r = await action();
    if (!r.ok) {
      setError(r.reason ?? 'The action was refused.');
      return;
    }
    setStatus(next);
    await load();
    onDone?.();
  };

  return (
    <div data-testid="entity-approval" className="space-y-4 p-1">
      <div className="flex items-center gap-2">
        {status === 'approved' ? (
          <CheckCircle2 className="w-5 h-5 text-verdigris stroke-[1.5]" />
        ) : status === 'rejected' ? (
          <XCircle className="w-5 h-5 text-cinnabar stroke-[1.5]" />
        ) : (
          <Clock className="w-5 h-5 text-secondary stroke-[1.5]" />
        )}
        <span className="text-apple-15 font-semibold text-primary">{entity.name}</span>
        <span
          data-testid="entity-status"
          className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary"
        >
          {status}
        </span>
      </div>

      {error && <InlineError message={error} testId="entity-approval-error" />}

      <div className="flex flex-wrap gap-2">
        {status === 'draft' && (
          <button
            type="button"
            data-testid="entity-submit"
            disabled={!canSubmit}
            title={canSubmit ? undefined : rightReason('perform_work')}
            onClick={() => void run(() => submitEntity(entity.id), 'pending')}
            className="px-3 py-1.5 rounded-lg bg-primary text-canvas text-apple-13 font-semibold disabled:opacity-40"
          >
            Submit for approval
          </button>
        )}
        {status === 'pending' && (
          <>
            <HoldToConfirm
              label="Approve"
              testId="entity-approve"
              durationMs={2000}
              onConfirm={() => void run(() => decideEntity(entity.id, true), 'approved')}
              disabled={!canDecide}
              title={canDecide ? undefined : rightReason('approve_plan')}
              className="relative overflow-hidden px-3 py-1.5 rounded-lg bg-verdigris-subtle text-verdigris text-apple-13 font-semibold disabled:opacity-40 transition-colors"
            >
              Approve
            </HoldToConfirm>
            <input
              aria-label="Rejection reason"
              placeholder="Rejection reason (min 10 chars)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 flex-1 min-w-[12rem] px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent"
            />
            <button
              type="button"
              data-testid="entity-reject"
              disabled={!canDecide || reason.trim().length < 10}
              onClick={() => void run(() => decideEntity(entity.id, false, reason), 'rejected')}
              className="px-3 py-1.5 rounded-lg border border-cinnabar text-cinnabar text-apple-13 font-semibold disabled:opacity-40"
            >
              Reject
            </button>
          </>
        )}
        {status === 'approved' && <p className="text-apple-13 text-secondary">This entity is approved.</p>}
        {status === 'rejected' && entity.rejectionReason && (
          <p className="text-apple-13 text-secondary">Rejected: {entity.rejectionReason}</p>
        )}
      </div>

      <div>
        <h3 className="text-apple-12 font-semibold text-primary mb-2 flex items-center gap-1.5">
          <History className="w-4 h-4 stroke-[1.5]" /> History
        </h3>
        {state === 'loading' && <p data-testid="entity-history-loading" className="text-apple-12 text-tertiary">Loading history…</p>}
        {state === 'ready' && history.length === 0 && (
          <p data-testid="entity-history-empty" className="text-apple-12 text-tertiary">No history yet.</p>
        )}
        {state === 'ready' && history.length > 0 && (
          <ul data-testid="entity-history" className="space-y-1 text-apple-12">
            {history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-hairline pb-1">
                <span className="text-primary">{h.action}</span>
                <span className="text-tertiary tabular-nums">{new Date(h.ts).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
