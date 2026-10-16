import React from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { ShieldCheck, ShieldAlert, Clock, CheckCircle2, XCircle } from '../common/Icons';

/**
 * Deployment gate outcomes (spec §7 steps 1-5). Rendered inside the sliding inspector; there is no
 * blocking modal. Each gate step is shown with its outcome so a refusal says exactly which step
 * failed and which right would let it pass.
 */
const STEP_LABELS: Record<string, string> = {
  entity_required: 'Entity is required',
  entity_not_found: 'Entity not found in this universe',
  entity_not_approved: 'Entity is not approved',
  plan_change_required: 'A plan change is required',
  period_mismatch: 'Plan period does not match',
  approval_required: 'Approval is required',
  deployed: 'Deployed',
};

export interface GateStepResult {
  outcome: string;
  step: number;
  detail?: string;
  requiredRight?: string;
}

export const DeploymentGatePanel: React.FC<{ result: GateStepResult | null }> = ({ result }) => {
  const { currentUser } = useApp();
  const canDeploy = hasRight(currentUser, 'manage_engagements');

  if (!result) {
    return (
      <div data-testid="deployment-gate-empty" className="p-4 text-apple-13 text-secondary">
        Run the deployment gate to see its outcome.
      </div>
    );
  }

  const ok = result.outcome === 'deployed';
  return (
    <div data-testid="deployment-gate" className="space-y-3 p-1">
      <div className="flex items-center gap-2">
        {ok ? (
          <ShieldCheck className="w-5 h-5 text-verdigris stroke-[1.5]" />
        ) : (
          <ShieldAlert className="w-5 h-5 text-cinnabar stroke-[1.5]" />
        )}
        <span className="text-apple-15 font-semibold text-primary">
          {ok ? 'Deployment approved' : 'Deployment blocked'}
        </span>
        <span
          data-testid="gate-step"
          className="px-2 py-0.5 rounded-full text-apple-11 font-semibold tabular-nums bg-surface-sunken text-secondary"
        >
          Step {result.step}
        </span>
      </div>
      <div data-testid="gate-outcome" className="flex items-start gap-2 text-apple-13 text-primary">
        {ok ? (
          <CheckCircle2 className="w-4 h-4 text-verdigris stroke-[1.5] mt-0.5 shrink-0" />
        ) : (
          <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5] mt-0.5 shrink-0" />
        )}
        <span>{STEP_LABELS[result.outcome] ?? result.outcome}</span>
      </div>
      {result.detail && <p className="text-apple-12 text-secondary">{result.detail}</p>}
      {!ok && result.requiredRight && (
        <p data-testid="gate-required-right" className="text-apple-12 text-secondary">
          Requires the <span className="font-semibold text-primary">{result.requiredRight}</span> right.
        </p>
      )}
      {!ok && !canDeploy && (
        <p className="text-apple-12 text-tertiary">You do not hold the right to deploy engagements.</p>
      )}
      <p className="text-apple-11 text-tertiary flex items-center gap-1">
        <Clock className="w-3.5 h-3.5 stroke-[1.5]" /> Gate checks run in the database; this panel only
        shows the outcome.
      </p>
    </div>
  );
};
