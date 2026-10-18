import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { listCaps, updateCap, closeCap, type CapRow, type CapStatus } from '../../data/caps';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { CheckCircle2, Clock, ShieldCheck } from '../common/Icons';

const CAP_STATUS_CHIP: Record<CapStatus, string> = {
  open: 'bg-surface-sunken border-hairline text-secondary',
  unverified: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
  verified_closed: 'bg-verdigris-subtle border-verdigris text-verdigris',
  verified_closed_delay: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
  overdue_unverified: 'bg-cinnabar-subtle border-cinnabar text-cinnabar',
};

const CAP_STATUS_LABEL: Record<CapStatus, string> = {
  open: 'Open',
  unverified: 'Unverified',
  verified_closed: 'Verified closed',
  verified_closed_delay: 'Verified closed (delay)',
  overdue_unverified: 'Overdue, unverified',
};

/**
 * CAP register (6H, spec §16). A list with status chips, an update form that moves a CAP from open to
 * unverified, and a right-gated close action. The status vocabulary is the single set from 0038
 * (D-6D-CAP); the transitions and the ledger live in the database.
 */
export const CapRegisterPanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const [caps, setCaps] = useState<CapRow[]>([]);
  const [draft, setDraft] = useState<Record<string, { action: string; evidence: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canWrite = hasRight(currentUser, 'perform_work');
  const canReview = hasRight(currentUser, 'review_and_approve');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCaps(await listCaps(engagementId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the CAP register.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const field = (id: string) => draft[id] ?? { action: '', evidence: '' };
  const setField = (id: string, patch: Partial<{ action: string; evidence: string }>) =>
    setDraft((p) => ({ ...p, [id]: { ...field(id), ...patch } }));

  const update = async (cap: CapRow) => {
    const f = field(cap.id);
    setBusy(true);
    setError(null);
    const res = await updateCap(cap.id, f.action, f.evidence);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const close = async (cap: CapRow, verified: boolean, delay: boolean) => {
    setBusy(true);
    setError(null);
    const res = await closeCap(cap.id, verified, delay);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="cap-loading" />;
  }

  return (
    <div className="space-y-4" data-testid="cap-register">
      <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5" /> Corrective Action Plan ({caps.length})
      </h3>
      <InlineError message={error} testId="cap-error" />

      {caps.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="cap-empty">
          No CAP entries exist for this engagement yet. Each finding or issue gets one before freeze.
        </div>
      ) : (
        <ul className="space-y-2">
          {caps.map((c) => {
            const f = field(c.id);
            const closed = c.status === 'verified_closed' || c.status === 'verified_closed_delay';
            return (
              <li key={c.id} className="p-4 rounded-2xl bg-surface border border-hairline space-y-2" data-testid={`cap-${c.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-apple-12 font-semibold text-primary">
                    {c.responsibleDept ?? 'Unassigned department'}
                  </span>
                  <span
                    data-testid={`cap-status-${c.id}`}
                    className={`px-2 py-0.5 rounded text-apple-11 font-semibold border ${CAP_STATUS_CHIP[c.status]}`}
                  >
                    {CAP_STATUS_LABEL[c.status]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-apple-11 text-secondary">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Due {c.dueDate ?? '—'}</span>
                  <span>{c.actionDescription || 'No action recorded'}</span>
                </div>
                {!closed && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        data-testid={`cap-action-${c.id}`}
                        value={f.action}
                        onChange={(e) => setField(c.id, { action: e.target.value })}
                        placeholder="Action description"
                        className="px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
                      />
                      <input
                        data-testid={`cap-evidence-${c.id}`}
                        value={f.evidence}
                        onChange={(e) => setField(c.id, { evidence: e.target.value })}
                        placeholder="Remediation evidence"
                        className="px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid={`cap-update-${c.id}`}
                        onClick={() => update(c)}
                        disabled={busy || !canWrite || (f.action.trim().length === 0 && f.evidence.trim().length === 0)}
                        className="px-3 py-1.5 rounded-lg bg-surface border border-hairline text-apple-12 font-semibold text-primary disabled:opacity-50"
                      >
                        Record update
                      </button>
                      <HoldToConfirm
                        label="Verify & close"
                        testId={`cap-close-${c.id}`}
                        durationMs={2000}
                        onConfirm={() => close(c, true, false)}
                        disabled={busy || !canReview}
                        title={!canReview ? rightReason('review_and_approve') : undefined}
                        className="relative overflow-hidden px-3 py-1.5 rounded-lg bg-surface border border-hairline text-apple-12 font-semibold text-primary disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Verify &amp; close
                      </HoldToConfirm>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
