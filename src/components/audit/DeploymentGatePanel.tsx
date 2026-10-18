import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { deployEngagement, type GateResult } from '../../data/deployment';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { InlineError } from '../common/InlineError';
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
  engagementId?: string;
}

export const DeploymentGatePanel: React.FC<{
  result: GateStepResult | null;
  /** The ids the deploy call needs. When present, the panel offers the final Deploy action. */
  deploy?: { universeId: string; entityId: string | null; planId?: string; period?: string; title?: string } | null;
  /** Called with the successful outcome so the caller can route to the new engagement. */
  onDeployed?: (engagementId: string | null) => void;
  /** Called with every fresh outcome so the caller can refresh its recorded gates. */
  onResult?: (result: GateResult) => void;
}> = ({ result: initialResult, deploy, onDeployed, onResult }) => {
  const { currentUser, setSelectedEngagementId } = useApp();
  const canDeploy = hasRight(currentUser, 'manage_engagements');
  const [result, setResult] = useState<GateStepResult | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!result) {
    // No outcome yet. With deploy context the panel can run the gate: deploy_engagement evaluates
    // every gate and only creates the engagement when they all pass, so the call is the gate check.
    if (deploy?.entityId && canDeploy) {
      return (
        <div data-testid="deployment-gate-run" className="space-y-3 p-1">
          <p className="text-apple-13 text-secondary">
            Run the deployment gate to check this entity against every step.
          </p>
          {error && <InlineError message={error} testId="gate-deploy-error" />}
          <HoldToConfirm
            label="Hold to run the gate and deploy"
            testId="gate-deploy"
            disabled={busy}
            onConfirm={() => void handleDeploy()}
          />
        </div>
      );
    }
    return (
      <div data-testid="deployment-gate-empty" className="p-4 text-apple-13 text-secondary">
        Run the deployment gate to see its outcome.
      </div>
    );
  }

  const ok = result.outcome === 'deployed';
  // The final Deploy action (§7 step 5) is offered only when the caller could actually pass every
  // gate: an entity is chosen, the caller holds the deploy right, and the record is not already
  // deployed. The database re-evaluates every gate on the call, so this is a trigger, not a bypass.
  const canAttemptDeploy = Boolean(deploy?.entityId) && canDeploy && result.outcome !== 'deployed';

  const handleDeploy = async () => {
    if (!deploy || !deploy.entityId) return;
    setBusy(true);
    setError(null);
    const outcome = await deployEngagement(
      deploy.universeId, deploy.entityId, deploy.planId, deploy.period, deploy.title
    );
    setBusy(false);
    if (!outcome) {
      setError('Deployment could not be recorded. Check your connection and try again.');
      return;
    }
    setResult(outcome);
    onResult?.(outcome);
    if (outcome.outcome === 'deployed') {
      const engagementId = outcome.engagementId ?? null;
      if (engagementId) setSelectedEngagementId(engagementId);
      onDeployed?.(engagementId);
    }
  };
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
      {error && <InlineError message={error} testId="gate-deploy-error" />}
      {ok ? (
        <button
          type="button"
          data-testid="gate-view-engagement"
          onClick={() => onDeployed?.(result.engagementId ?? null)}
          className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-primary hover:bg-surface-hover"
        >
          Open the audit file
        </button>
      ) : (
        canAttemptDeploy && (
          <HoldToConfirm
            label="Hold to deploy"
            testId="gate-deploy"
            disabled={busy}
            onConfirm={() => void handleDeploy()}
          />
        )
      )}
      <p className="text-apple-11 text-tertiary flex items-center gap-1">
        <Clock className="w-3.5 h-3.5 stroke-[1.5]" /> Gate checks run in the database; this panel only
        shows the outcome.
      </p>
    </div>
  );
};
