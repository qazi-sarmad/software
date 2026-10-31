import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  decideDeployment,
  deployFromPlan,
  listDeployments,
  listDeploymentSuggestions,
  listFileOwners,
  setFileOwner,
  type DeploymentRow,
  type DeploymentSuggestion,
  type FileOwnerRow,
} from '../../data/planDeployment';
import { listPlanItems, latestPlanForUniverse, type PlanItemRow } from '../../data/plan';
import { listMembers, type MemberRow } from '../../data/admin';
import { listFileOwnerAudit, type FileOwnerAuditRow } from '../../data/fileOwnership';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Check, Shield, XCircle, ShieldAlert } from '../common/Icons';

export interface PlanDeploymentPanelProps {
  universeId?: string;
  /** The engagement the file owner is named for, when opened from an audit file. */
  engagementId?: string;
  onDeployed?: () => void;
}

/**
 * Deployment from the plan (owner instruction 2026-10-30): the file owner of each engagement,
 * deployment when due, and — when deployed earlier — the reason and the approval by the org's
 * configured role. The deterministic consequences for the audit calendar, the board pack and the
 * plan are shown as suggestions: DATA the reader acts on, never an automatic write to another
 * surface.
 *
 * Every control is gated by a right (hasRight), never a role name. An early deployment is refused
 * without a reason and is held for approval; nothing is deployed while it is pending.
 */
export const PlanDeploymentPanel: React.FC<PlanDeploymentPanelProps> = ({ universeId, engagementId, onDeployed }) => {
  const { currentUser } = useApp();
  const canDeploy = hasRight(currentUser, 'manage_engagements');

  const [items, setItems] = useState<PlanItemRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [owners, setOwners] = useState<FileOwnerRow[]>([]);
  const [ownerAudit, setOwnerAudit] = useState<FileOwnerAuditRow[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, DeploymentSuggestion[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [planItemId, setPlanItemId] = useState('');
  const [onDate, setOnDate] = useState('');
  const [reason, setReason] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [decisionReason, setDecisionReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, deps] = await Promise.all([listMembers(), listDeployments()]);
      setMembers(m);
      setDeployments(deps);
      const withSuggestions: Record<string, DeploymentSuggestion[]> = {};
      for (const d of deps) withSuggestions[d.id] = await listDeploymentSuggestions(d.id);
      setSuggestions(withSuggestions);
      setOwners(await listFileOwners());
      setOwnerAudit(await listFileOwnerAudit());
      if (universeId) {
        const plan = await latestPlanForUniverse(universeId);
        setItems(plan ? await listPlanItems(plan.id) : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The deployment records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [universeId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await deployFromPlan(planItemId, onDate || null, reason);
      if (!result) { setError('The deployment could not be sent.'); return; }
      if (result.outcome === 'reason_required') {
        setError('An early deployment needs a reason of at least 10 characters.');
      } else if (result.outcome === 'early_approval_required') {
        setNotice(`Held for approval by the configured role (${result.approvalRight}). Nothing is deployed until it is decided.`);
      } else {
        setNotice('The engagement was deployed from the plan.');
        onDeployed?.();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The deployment was refused.');
    }
  };

  const decide = async (deploymentId: string, approve: boolean) => {
    setError(null);
    setNotice(null);
    try {
      await decideDeployment(deploymentId, approve, decisionReason);
      setNotice(approve ? 'The early deployment was approved and the engagement deployed.' : 'The early deployment was refused.');
      setDecisionReason('');
      await load();
      if (approve) onDeployed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision was refused.');
    }
  };

  const nameOwner = async () => {
    setError(null);
    setNotice(null);
    try {
      await setFileOwner(engagementId!, ownerUserId, planItemId || null, reason);
      setNotice('The file owner was named.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file owner could not be named.');
    }
  };

  const pending = deployments.filter((d) => d.status === 'pending_approval');

  return (
    <div data-testid="deployment-plan-panel" className="p-5 space-y-5">
      <header>
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">Deployment</span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">Deploy from the plan</h3>
        <p className="text-apple-12 text-secondary mt-1">
          Deploy when the plan is due. An earlier deployment needs a reason and the approval of the
          organisation&rsquo;s configured role.
        </p>
      </header>

      <InlineError message={error} testId="deployment-plan-error" />
      {notice && (
        <div data-testid="deployment-plan-notice" className="rounded-xl border border-verdigris bg-verdigris-subtle px-3 py-2 text-apple-12 text-primary">
          {notice}
        </div>
      )}

      {/* File owner ---------------------------------------------------------- */}
      {engagementId && canDeploy && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
          <h4 className="text-apple-14 font-semibold text-primary">File owner</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Person</span>
              <Select ariaLabel="File owner" testId="deployment-plan-owner-user" value={ownerUserId} onChange={setOwnerUserId}
                options={[{ value: '', label: 'Select a person' }, ...members.map((m) => ({ value: m.userId, label: m.displayName || m.userId.slice(0, 8) }))]} />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Reason (optional)</span>
              <input
                data-testid="deployment-plan-owner-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              />
            </label>
            <button type="button" data-testid="deployment-plan-owner-save" onClick={() => void nameOwner()}
              className="px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium">
              Name file owner
            </button>
          </div>
        </section>
      )}

      {/* Deploy from a plan item -------------------------------------------- */}
      {canDeploy && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
          <h4 className="text-apple-14 font-semibold text-primary">Deploy a plan item</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Plan item</span>
              <Select ariaLabel="Plan item" testId="deployment-plan-item" value={planItemId} onChange={setPlanItemId}
                options={[{ value: '', label: 'Select a plan item' }, ...items.map((i) => ({ value: i.id, label: i.title }))]} />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Deploy on</span>
              <input
                data-testid="deployment-plan-date"
                type="date"
                value={onDate}
                onChange={(e) => setOnDate(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Reason for an early deployment</span>
              <input
                data-testid="deployment-plan-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary"
              />
            </label>
            <button type="button" data-testid="deployment-plan-submit" disabled={!planItemId} onClick={() => void submit()}
              className="px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium disabled:opacity-50">
              Deploy
            </button>
          </div>
          <p className="text-apple-11 text-tertiary">
            An early deployment (a date before the plan item&rsquo;s start) is held until the configured
            approver decides it; nothing is deployed while it is pending.
          </p>
        </section>
      )}

      {!canDeploy && (
        <p data-testid="deployment-plan-readonly" className="text-apple-12 text-secondary">
          Deploying an engagement needs the <em>Manage engagements</em> right.
        </p>
      )}

      {/* File owners -------------------------------------------------------- */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h4 className="text-apple-14 font-semibold text-primary">File owners</h4>
        {loading ? (
          <p className="text-apple-12 text-secondary">Loading…</p>
        ) : owners.length === 0 ? (
          <p data-testid="deployment-plan-owners-empty" className="text-apple-12 text-secondary">No file owner has been named.</p>
        ) : (
          owners.map((o) => (
            <div key={o.engagementId} data-testid={`deployment-plan-owner-${o.engagementId}`} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-hairline">
              <span className="text-apple-13 text-primary flex-1">{o.engagementTitle}</span>
              <span className="text-apple-12 text-secondary">{o.userId.slice(0, 8)}</span>
              <span className="text-apple-11 text-secondary">v{o.version}</span>
            </div>
          ))
        )}
      </section>

      {/* File owner accountability (0202) ----------------------------------- */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 stroke-[1.5] text-accent" />
          <h4 className="text-apple-14 font-semibold text-primary">Every audit file has an owner</h4>
        </div>
        <p className="text-apple-12 text-secondary">
          A file cannot exist or be sealed without an owner. A file given one by default needs its
          assignment confirmed by a person.
        </p>
        {loading ? (
          <p data-testid="deployment-plan-owner-audit-loading" className="text-apple-12 text-secondary">Loading…</p>
        ) : ownerAudit.length === 0 ? (
          <p data-testid="deployment-plan-owner-audit-empty" className="text-apple-12 text-secondary">
            No audit file exists in this organisation yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="deployment-plan-owner-audit">
            {ownerAudit.map((f) => (
              <li
                key={f.engagementId}
                data-testid={`deployment-plan-owner-audit-${f.engagementId}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2"
              >
                <span className="text-apple-13 text-primary">{f.title}</span>
                <span className="text-apple-12 text-secondary">{f.universeName || '—'}</span>
                <span className="text-apple-12 text-secondary">{f.stage}</span>
                <span className="text-apple-12 text-secondary">
                  owner {f.ownerName || (f.ownerUserId ? f.ownerUserId.slice(0, 8) : '—')}
                </span>
                {f.backfillRequired && (
                  <span
                    data-testid={`deployment-plan-owner-audit-flag-${f.engagementId}`}
                    className="rounded-lg border border-cinnabar bg-cinnabar-subtle px-2 py-0.5 text-apple-11 text-primary"
                  >
                    assignment needs confirming
                  </span>
                )}
                {f.sealed && (
                  <span className="rounded-lg border border-hairline px-2 py-0.5 text-apple-11 text-secondary">sealed</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pending early deployments ------------------------------------------ */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h4 className="text-apple-14 font-semibold text-primary">Early deployments awaiting a decision</h4>
        {loading ? (
          <p data-testid="deployment-plan-loading" className="text-apple-12 text-secondary">Loading…</p>
        ) : pending.length === 0 ? (
          <p data-testid="deployment-plan-pending-empty" className="text-apple-12 text-secondary">No early deployment is awaiting a decision.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((d) => (
              <div key={d.id} data-testid={`deployment-plan-pending-${d.id}`} className="rounded-xl border border-cinnabar bg-cinnabar-subtle px-3 py-2 space-y-2">
                <div className="flex items-center gap-2 text-apple-13 text-primary">
                  <Shield className="w-4 h-4 stroke-[1.5]" />
                  <span className="font-medium">{d.title}</span>
                  <span className="text-secondary">due {d.dueOn ?? '—'} · requested for {d.deployedOn}</span>
                </div>
                <p data-testid={`deployment-plan-pending-reason-${d.id}`} className="text-apple-12 text-secondary">
                  Reason: {d.reason}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    data-testid={`deployment-plan-decision-reason-${d.id}`}
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="Decision note (optional)"
                    className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-apple-12 text-primary"
                  />
                  <button type="button" data-testid={`deployment-plan-approve-${d.id}`} onClick={() => void decide(d.id, true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-verdigris-subtle text-verdigris text-apple-12 font-medium">
                    <Check className="w-4 h-4 stroke-[1.5]" /> Approve
                  </button>
                  <button type="button" data-testid={`deployment-plan-refuse-${d.id}`} onClick={() => void decide(d.id, false)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-hairline text-primary text-apple-12 font-medium">
                    <XCircle className="w-4 h-4 stroke-[1.5]" /> Refuse
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Suggestions -------------------------------------------------------- */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h4 className="text-apple-14 font-semibold text-primary">Suggested changes</h4>
        <p className="text-apple-12 text-secondary">
          The consequences of a deployment for the audit calendar, the board pack and the plan. These
          are suggestions to act on, not automatic changes.
        </p>
        {deployments.length === 0 ? (
          <p data-testid="deployment-plan-suggestions-empty" className="text-apple-12 text-secondary">No deployment has been made yet.</p>
        ) : (
          deployments.map((d) => (
            <div key={d.id} data-testid={`deployment-plan-suggestions-${d.id}`} className="space-y-1">
              <div className="text-apple-12 text-primary font-medium">{d.title}</div>
              {(suggestions[d.id] ?? []).map((s, i) => (
                <div key={i} data-testid={`deployment-plan-suggestion-${d.id}-${s.target}`} className="flex items-start gap-2 text-apple-12">
                  <span className="text-apple-10 uppercase tracking-wider text-secondary w-28 shrink-0 pt-0.5">{s.target.replace('_', ' ')}</span>
                  <span className="text-primary">{s.suggestion}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </section>
    </div>
  );
};
