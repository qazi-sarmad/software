import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { useScopedData } from '../../hooks/useScopedData';
import { decideCombinedDeployment, requestCombinedDeployment } from '../../data/deployment';
import { InlineError } from '../common/InlineError';
import { CheckCircle2, Clock, Send, XCircle } from '../common/Icons';

export interface DeploymentRequestView {
  id: string;
  universeId: string;
  entityId: string;
  title: string;
  period: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'escalated';
  reason: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
}

/**
 * Combined approval (spec §7.1): a plan change and a deployment decided in one atomic action. The
 * four-eyes rule is enforced in the database; the panel only surfaces it. Renders inside the sliding
 * inspector, never a blocking modal.
 */
export const CombinedApprovalPanel: React.FC<{
  request: DeploymentRequestView | null;
  universeId?: string;
  entityId?: string;
  onRequested?: () => void;
}> = ({ request, universeId, entityId, onRequested }) => {
  const { currentUser } = useApp();
  const canRaise = hasRight(currentUser, 'perform_work');
  const canDecide = hasRight(currentUser, 'approve_plan');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [raised, setRaised] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // The entities in scope come from the shared data hook, not a direct client call: components
  // never import the Supabase client. Scoped to the selected universe, sorted by name.
  const { scopedEntities } = useScopedData();
  const entities = useMemo(
    () =>
      scopedEntities
        .filter((e) => !universeId || e.universeId === universeId)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [scopedEntities, universeId]
  );

  // Default the picker to the entity the panel was opened with, if any, else the first in scope.
  useEffect(() => {
    setSelectedEntityId((prev) => prev ?? entityId ?? entities[0]?.id ?? null);
  }, [entityId, entities]);

  const raise = async () => {
    const target = selectedEntityId ?? entityId;
    if (!universeId || !target) return;
    setBusy(true);
    setError(null);
    const r = await requestCombinedDeployment(universeId, target);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setRaised(true);
    onRequested?.();
  };

  const decide = async (approve: boolean) => {
    if (!request) return;
    setBusy(true);
    setError(null);
    const r = await decideCombinedDeployment(request.id, approve);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    onRequested?.();
  };

  return (
    <div data-testid="combined-approval" className="space-y-4 p-1">
      <h2 className="text-apple-15 font-semibold text-primary">Combined plan change + deployment</h2>
      <p className="text-apple-12 text-secondary">
        One atomic decision applies the plan change and the deployment, or neither. Revalidation runs
        inside the same transaction.
      </p>

      {error && <InlineError message={error} testId="combined-approval-error" />}

      {!request ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="combined-entity" className="block text-apple-12 font-medium text-primary">
              Entity to deploy
            </label>
            {entities.length === 0 ? (
              <p data-testid="combined-entity-empty" className="text-apple-12 text-tertiary">
                No entities are in scope for this universe. Add an entity first, then raise a combined request.
              </p>
            ) : (
              <select
                id="combined-entity"
                data-testid="combined-entity-picker"
                value={selectedEntityId ?? ''}
                onChange={(e) => setSelectedEntityId(e.target.value || null)}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-1.5 text-apple-13 text-primary"
              >
                <option value="">Select an entity…</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            type="button"
            data-testid="combined-raise"
            disabled={!canRaise || !universeId || !selectedEntityId || busy}
            title={canRaise ? undefined : rightReason('perform_work')}
            onClick={() => void raise()}
            className="px-3 py-1.5 rounded-lg bg-primary text-canvas text-apple-13 font-semibold disabled:opacity-40 flex items-center gap-1.5"
          >
            <Send className="w-4 h-4 stroke-[1.5]" /> Raise a combined request
          </button>
          {raised && <p data-testid="combined-raised" className="text-apple-12 text-verdigris">Request raised.</p>}
        </div>
      ) : (
        <div data-testid="combined-request" className="space-y-3">
          <div className="flex items-center gap-2">
            {request.status === 'approved' ? (
              <CheckCircle2 className="w-5 h-5 text-verdigris stroke-[1.5]" />
            ) : request.status === 'rejected' ? (
              <XCircle className="w-5 h-5 text-cinnabar stroke-[1.5]" />
            ) : (
              <Clock className="w-5 h-5 text-secondary stroke-[1.5]" />
            )}
            <span className="font-semibold text-primary">{request.title}</span>
            <span
              data-testid="combined-status"
              className="px-2 py-0.5 rounded-full text-apple-11 font-semibold uppercase bg-surface-sunken text-secondary"
            >
              {request.status}
            </span>
          </div>
          {request.period && <p className="text-apple-12 text-secondary">Period: {request.period}</p>}
          {request.slaDueAt && (
            <p data-testid="combined-sla" className="text-apple-12 text-secondary">
              SLA due: {new Date(request.slaDueAt).toLocaleString()}
            </p>
          )}
          {request.escalatedAt && (
            <p data-testid="combined-escalated" className="text-apple-12 text-cinnabar">
              Escalated: {new Date(request.escalatedAt).toLocaleString()}
            </p>
          )}
          {request.reason && <p className="text-apple-12 text-secondary">{request.reason}</p>}
          {request.status === 'pending' && (
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="combined-approve"
                disabled={!canDecide || busy}
                title={canDecide ? undefined : rightReason('approve_plan')}
                onClick={() => void decide(true)}
                className="px-3 py-1.5 rounded-lg bg-verdigris-subtle text-verdigris text-apple-13 font-semibold disabled:opacity-40"
              >
                Approve both
              </button>
              <button
                type="button"
                data-testid="combined-reject"
                disabled={!canDecide || busy}
                onClick={() => void decide(false)}
                className="px-3 py-1.5 rounded-lg border border-cinnabar text-cinnabar text-apple-13 font-semibold disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
