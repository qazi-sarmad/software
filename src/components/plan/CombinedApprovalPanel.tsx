import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
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

  const raise = async () => {
    if (!universeId || !entityId) return;
    setBusy(true);
    setError(null);
    const r = await requestCombinedDeployment(universeId, entityId);
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
        <div className="space-y-2">
          <button
            type="button"
            data-testid="combined-raise"
            disabled={!canRaise || !universeId || !entityId || busy}
            title={canRaise ? undefined : 'Requires the perform work right'}
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
                title={canDecide ? undefined : 'Requires the approve plan right'}
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
