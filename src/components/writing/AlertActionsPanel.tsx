import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import {
  alertAdhocSuggestion, alertAdhocAuditRaise, alertRaiseFinding, alertRaiseCap,
  alertRequestEvidence, alertEscalate, listEngagementOptions, listEvidenceRequests,
  type AlertRow, type AlertAdhocSuggestion, type EngagementOption, type EvidenceRequestRow,
} from '../../data/writing';

type Action = 'adhoc' | 'finding' | 'cap' | 'evidence' | 'escalate';

/**
 * Acting on an alert — Phase 5, C4/C5/C6.
 *
 * Given one alert, whose C2 enrichment has already resolved entity, department, SIRA risk and
 * controls), this panel offers the things a triager can DO — and pre-fills every one of them from the
 * alert, so nobody retypes what the platform already knows:
 *   C4  raise an ad-hoc audit (entity, department, controls, draft plan pre-filled);
 *   C5  raise a finding (readability sections pre-filled), raise a CAP, request evidence, escalate.
 *
 * C6 is rights gating: an action is shown only when the caller holds the right it needs. Raising a
 * finding, a CAP or an evidence request needs `perform_work` (the right those RPCs check); escalating
 * needs `review_and_approve` (the triage right). A caller who cannot do a thing does not see the
 * button — the database would refuse it anyway, and the UI should not offer what it cannot deliver.
 */
export const AlertActionsPanel: React.FC<{
  prefix?: string;
  alert: AlertRow;
  onDone?: () => void;
}> = ({ prefix = 'alert-actions', alert, onDone }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canPerform = hasRight(currentUser, 'perform_work');
  const canApprove = hasRight(currentUser, 'review_and_approve');

  const [open, setOpen] = useState<Action | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<AlertAdhocSuggestion | null>(null);
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  const [requests, setRequests] = useState<EvidenceRequestRow[]>([]);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState('');
  const [evidence, setEvidence] = useState({ from: '', description: '', due: '' });
  const [cap, setCap] = useState({ dept: alert.department ?? '', due: '', action: '' });

  const reload = useCallback(async () => {
    try {
      const [sug, eng, req] = await Promise.all([
        alertAdhocSuggestion(orgId, alert.alertId),
        listEngagementOptions(),
        listEvidenceRequests(orgId, alert.alertId),
      ]);
      setSuggestion(sug);
      setEngagements(eng);
      setRequests(req);
      setEngagementId((cur) => cur || sug?.engagementId || eng[0]?.id || '');
    } catch {
      // Reads failing is not fatal here: the buttons still attempt the write, which reports why.
    }
  }, [orgId, alert.alertId]);

  useEffect(() => { void reload(); }, [reload]);

  const act = async (fn: () => Promise<{ ok: boolean; reason?: string; id?: string }>, done: string) => {
    setBusy(true);
    setResult(null);
    const r = await fn();
    setBusy(false);
    setResult(r.ok ? done : (r.reason ?? 'The action was refused.'));
    if (r.ok) { await reload(); onDone?.(); }
    return r;
  };

  const engagementOptions = engagements.map((e) => ({ value: e.id, label: e.title || e.id }));

  return (
    <div className="space-y-3 border-t border-hairline pt-3" data-testid={`${prefix}-panel`}>
      <InlineError message={result && !result.startsWith('Done') ? result : null} testId={`${prefix}-result`} />
      {result?.startsWith('Done') && (
        <div className="text-apple-12 text-verdigris" data-testid={`${prefix}-done`}>{result}</div>
      )}

      <div className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-buttons`}>
        {canPerform && (
          <button type="button" data-testid={`${prefix}-open-adhoc`}
            className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold"
            onClick={() => setOpen(open === 'adhoc' ? null : 'adhoc')}>
            Raise ad-hoc audit
          </button>
        )}
        {canPerform && (
          <button type="button" data-testid={`${prefix}-open-finding`}
            className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold"
            onClick={() => setOpen(open === 'finding' ? null : 'finding')}>
            Raise finding
          </button>
        )}
        {canPerform && (
          <button type="button" data-testid={`${prefix}-open-evidence`}
            className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold"
            onClick={() => setOpen(open === 'evidence' ? null : 'evidence')}>
            Request evidence
          </button>
        )}
        {canApprove && (
          <button type="button" data-testid={`${prefix}-open-escalate`}
            className="px-3 py-1.5 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold"
            onClick={() => setOpen(open === 'escalate' ? null : 'escalate')}>
            Escalate
          </button>
        )}
      </div>

      {!canPerform && !canApprove && (
        <div className="text-apple-11 text-secondary" data-testid={`${prefix}-denied`}>
          You can see this alert but not act on it: raising work needs the perform_work right, and
          escalating needs review_and_approve.
        </div>
      )}

      {/* C4 — the ad-hoc audit, pre-filled from the alert. */}
      {open === 'adhoc' && suggestion && (
        <div className="p-3 rounded-xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-adhoc-form`}>
          <div className="text-apple-12 text-secondary">
            {suggestion.title} — {suggestion.department ?? 'no department'} ·{' '}
            {suggestion.controlCount} control(s) · {suggestion.residualBand ?? 'no SIRA residual'}
          </div>
          <div className="text-apple-11 text-secondary" data-testid={`${prefix}-adhoc-justification`}>
            {suggestion.justification}
          </div>
          <button type="button" data-testid={`${prefix}-adhoc-submit`} disabled={busy || !suggestion.planId}
            className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
            onClick={() => void act(() => alertAdhocAuditRaise(orgId, alert.alertId, suggestion.planId!,
              suggestion.title, suggestion.justification), 'Done: ad-hoc audit raised for approval.')}>
            {suggestion.planId ? 'Raise as a pending ad-hoc item' : 'No draft plan for this universe'}
          </button>
        </div>
      )}

      {/* C5 — the finding, pre-filled with the mandatory readability sections. */}
      {open === 'finding' && (
        <div className="p-3 rounded-xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-finding-form`}>
          <Select ariaLabel="Engagement" testId={`${prefix}-finding-engagement`} value={engagementId}
            onChange={setEngagementId} options={engagementOptions} />
          <button type="button" data-testid={`${prefix}-finding-submit`} disabled={busy || !engagementId}
            className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
            onClick={() => void act(async () => {
              const r = await alertRaiseFinding(orgId, alert.alertId, engagementId);
              if (r.ok && r.id) { setFindingId(r.id); setCap((c) => ({ ...c, dept: c.dept || (alert.department ?? '') })); }
              return r;
            }, 'Done: finding raised with the alert’s context.')}>
            Raise finding from this alert
          </button>
          {findingId && (
            <div className="space-y-2" data-testid={`${prefix}-cap-form`}>
              <div className="text-apple-11 text-secondary">Raise a CAP for the finding you just raised.</div>
              <input type="text" placeholder="Responsible department" data-testid={`${prefix}-cap-dept`}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-12 text-primary"
                value={cap.dept} onChange={(e) => setCap({ ...cap, dept: e.target.value })} />
              <input type="text" placeholder="Due date (ISO)" data-testid={`${prefix}-cap-due`}
                className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-12 text-primary"
                value={cap.due} onChange={(e) => setCap({ ...cap, due: e.target.value })} />
              <button type="button" data-testid={`${prefix}-cap-submit`} disabled={busy}
                className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
                onClick={() => void act(() => alertRaiseCap(orgId, alert.alertId, findingId,
                  cap.dept || null, cap.due || null, cap.action || null),
                  'Done: CAP raised on the register.')}>
                Raise CAP
              </button>
            </div>
          )}
        </div>
      )}

      {/* C5 — request evidence. */}
      {open === 'evidence' && (
        <div className="p-3 rounded-xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-evidence-form`}>
          <input type="text" placeholder="Request from" data-testid={`${prefix}-evidence-from`}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-12 text-primary"
            value={evidence.from} onChange={(e) => setEvidence({ ...evidence, from: e.target.value })} />
          <input type="text" placeholder="What is needed" data-testid={`${prefix}-evidence-description`}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-12 text-primary"
            value={evidence.description} onChange={(e) => setEvidence({ ...evidence, description: e.target.value })} />
          <input type="text" placeholder="Due date (ISO, optional)" data-testid={`${prefix}-evidence-due`}
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-apple-12 text-primary"
            value={evidence.due} onChange={(e) => setEvidence({ ...evidence, due: e.target.value })} />
          <button type="button" data-testid={`${prefix}-evidence-submit`}
            disabled={busy || !evidence.from.trim() || !evidence.description.trim()}
            className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
            onClick={() => void act(() => alertRequestEvidence(orgId, alert.alertId, engagementId || null,
              evidence.from, evidence.description, evidence.due || null), 'Done: evidence requested.')}>
            Request evidence
          </button>
        </div>
      )}

      {/* C5 — escalate into an observation. */}
      {open === 'escalate' && (
        <div className="p-3 rounded-xl bg-surface border border-hairline space-y-2" data-testid={`${prefix}-escalate-form`}>
          <Select ariaLabel="Engagement" testId={`${prefix}-escalate-engagement`} value={engagementId}
            onChange={setEngagementId} options={engagementOptions} />
          <button type="button" data-testid={`${prefix}-escalate-submit`} disabled={busy || !engagementId}
            className="px-4 py-2 rounded-lg bg-accent-subtle text-primary text-apple-12 font-semibold disabled:opacity-50"
            onClick={() => void act(() => alertEscalate(orgId, alert.alertId, engagementId),
              'Done: alert escalated into an observation.')}>
            Escalate into an observation
          </button>
        </div>
      )}

      {requests.length > 0 && (
        <ul className="space-y-1" data-testid={`${prefix}-evidence-list`}>
          {requests.map((r) => (
            <li key={r.id} className="text-apple-11 text-secondary" data-testid={`${prefix}-evidence-${r.id}`}>
              Evidence from {r.requestedFrom}: {r.description} ({r.status})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
