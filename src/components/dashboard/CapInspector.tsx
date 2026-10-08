import React, { useState } from 'react';
import { AuditCapItem, CapStatus, RetestStatus, Severity } from '../../types';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { isCapOverdue } from '../../lib/orgDate';
import { ACTION_CAPABILITY } from '../../lib/cap';
import { canPerformCapability } from '../../lib/orgCapabilities';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  ShieldCheck,
  User,
  Calendar,
} from '../common/Icons';

interface CapInspectorProps {
  data?: {
    department?: string;
    severity?: Severity;
    cap?: AuditCapItem;
    caps?: AuditCapItem[];
  };
  onClose?: () => void;
}

export const CapInspector: React.FC<CapInspectorProps> = ({ data, onClose }) => {
  const { transitionCap, orgRoleConfig, openInspector, setActiveTab, setSelectedEngagementId, currentUser } = useApp();
  const { scopedCapItems, scopedEngagements } = useScopedData();

  // If a single CAP was clicked, show detail or list
  const activeDepartment = data?.department || (data?.cap ? data.cap.department : null);
  const items = data?.caps
    ? data.caps
    : data?.cap
    ? [data.cap]
    : activeDepartment
    ? scopedCapItems.filter((c) => c.department === activeDepartment)
    : scopedCapItems;

  const [selectedCapId, setSelectedCapId] = useState<string | null>(
    data?.cap ? data.cap.id : items[0]?.id || null
  );

  const selectedId = selectedCapId || items[0]?.id;
  const live = selectedId ? scopedCapItems.find((c) => c.id === selectedId) : undefined;
  const activeCap = live || items.find((c) => c.id === selectedId) || items[0];

  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'submit' | 'reject' | 'fail' | 'verify'>('none');

  // Show an action only to designations that hold its capability (four-eyes still enforced on click).
  const allowed = (action: keyof typeof ACTION_CAPABILITY) =>
    canPerformCapability(currentUser, ACTION_CAPABILITY[action], orgRoleConfig, {
      submitterUserId: activeCap?.lastSubmittedByUserId,
    }).allowed;

  const run = (action: 'mark_in_progress' | 'submit_validation' | 'verify_close' | 'reject' | 'fail_retest') => {
    if (!activeCap) return;
    const evidenceRefs = evidence
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const result = transitionCap(activeCap.id, action, {
      note: note || undefined,
      evidenceRefs: evidenceRefs.length ? evidenceRefs : undefined,
      rejectTo: 'In progress',
    });
    if (!result.ok) {
      setFormError(result.reason);
      return;
    }
    setFormError(null);
    setNote('');
    setEvidence('');
    setPanel('none');
  };


  const getSeverityBadge = (sev: Severity) => {
    switch (sev) {
      case 'critical':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold uppercase bg-cinnabar-subtle text-cinnabar border border-cinnabar">
            Critical
          </span>
        );
      case 'high':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold uppercase bg-cinnabar-subtle text-cinnabar">
            High
          </span>
        );
      case 'medium':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold uppercase bg-verdigris-subtle text-verdigris border border-verdigris">
            Medium
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-medium uppercase bg-surface-elevated text-secondary border border-hairline">
            Low
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="border-b border-hairline pb-4">
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
          Remediation Assurance Inspector
        </span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">
          {activeDepartment ? `${activeDepartment} Corrective Actions` : 'Corrective Action Plan Detail'}
        </h3>
        <p className="text-apple-12 text-secondary mt-1">
          {items.length} remediation commitment{items.length === 1 ? '' : 's'} assigned to this scope.
        </p>
      </div>

      {/* Item selector pills if multiple items in department */}
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          {items.map((c) => {
            const isSelected = c.id === activeCap?.id;
            const isOvd = isCapOverdue(c.status, c.dueDate);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCapId(c.id)}
                className={`px-3 py-1.5 rounded-xl text-apple-12 font-medium shrink-0 transition-colors border flex items-center gap-2 ${
                  isSelected
                    ? 'bg-accent text-canvas border-accent shadow-xs'
                    : 'bg-surface-elevated border-hairline text-secondary hover:text-primary hover:bg-surface-hover'
                }`}
              >
                <span>{c.id}</span>
                {isOvd && (
                  <span className="w-2 h-2 rounded-full bg-cinnabar shrink-0 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Active CAP Details Card */}
      {activeCap ? (
        <div className="space-y-6">
          {/* Overdue Pulsing Banner if overdue (§ 3.4 requirement) */}
          {(isCapOverdue(activeCap.status, activeCap.dueDate)) && (
            <div className="p-3.5 rounded-xl bg-cinnabar-subtle border border-cinnabar flex items-center justify-between animate-pulse">
              <div className="flex items-center gap-2.5 text-cinnabar">
                <AlertCircle className="w-4 h-4 stroke-[2]" />
                <span className="text-apple-12 font-semibold">
                  Remediation Target Overdue ({activeCap.agingDays} days aging)
                </span>
              </div>
              <span className="text-apple-11 font-medium text-cinnabar uppercase">
                Escalated to CIA
              </span>
            </div>
          )}

          {/* Title and Badges */}
          <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-apple-11 font-mono text-accent font-semibold">
                  {activeCap.id} • {activeCap.department}
                </div>
                <h4 className="text-apple-17 font-bold text-primary mt-1">
                  {activeCap.title}
                </h4>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {getSeverityBadge(activeCap.severity)}
                <span className="px-2 py-0.5 rounded text-apple-11 font-medium bg-surface text-secondary border border-hairline">
                  {activeCap.approvalStatus}
                </span>
              </div>
            </div>

            <div className="text-apple-13 text-secondary leading-relaxed bg-surface p-3.5 rounded-xl border border-hairline">
              <div className="text-apple-11 font-semibold text-primary uppercase mb-1">
                Remediation Commitment &amp; Action Plan
              </div>
              {activeCap.action}
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-apple-12">
              <div className="p-2.5 rounded-xl bg-surface border border-hairline">
                <div className="text-apple-11 text-tertiary">Action Owner</div>
                <div className="font-semibold text-primary mt-0.5 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />
                  <span className="truncate">{activeCap.owner}</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-surface border border-hairline">
                <div className="text-apple-11 text-tertiary">Target Due Date</div>
                <div className="font-semibold text-primary mt-0.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-secondary stroke-[1.5]" />
                  <span>{activeCap.dueDate}</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-surface border border-hairline">
                <div className="text-apple-11 text-tertiary">Current Status</div>
                <div className="font-semibold text-primary mt-0.5">
                  {activeCap.status}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-surface border border-hairline">
                <div className="text-apple-11 text-tertiary">Independent Re-Test</div>
                <div className="font-semibold text-primary mt-0.5">
                  {activeCap.retestStatus}
                </div>
              </div>
            </div>

            {/* Link to originating report (§ 3.4 requirement) */}
            <div className="pt-2 border-t border-hairline flex items-center justify-between">
              <div className="flex items-center gap-2 text-apple-12 text-secondary min-w-0">
                <FileText className="w-4 h-4 stroke-[1.5] text-accent shrink-0" />
                <span className="truncate">Originating: {activeCap.originatingReport}</span>
              </div>
              <button
                onClick={() => {
                  const eng = scopedEngagements.find((e) => e.id === activeCap.engagementId);
                  if (eng) {
                    setSelectedEngagementId(eng.id);
                    openInspector('audit_file', { engagement: eng });
                  } else {
                    setActiveTab('issues');
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent-subtle hover:bg-accent-hover text-accent text-apple-12 font-medium transition-colors shrink-0"
              >
                <span>View Audit Report</span>
                <ExternalLink className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
          </div>

          {/* Status history */}
          {(activeCap.statusHistory?.length ?? 0) > 0 && (
            <div className="p-5 rounded-2xl bg-surface-sunken border border-hairline space-y-2">
              <h5 className="text-apple-13 font-semibold text-primary">Status history</h5>
              <ul className="space-y-2">
                {activeCap.statusHistory!.map((h) => (
                  <li key={h.id} className="text-apple-12 text-secondary border-b border-hairline pb-2 last:border-0">
                    <span className="text-primary font-medium">{h.actorName}</span>
                    {' '}({h.actorRole}): {h.fromStatus} → {h.toStatus}
                    {h.note ? <div className="text-tertiary mt-0.5">{h.note}</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Remediation Lifecycle Management Actions */}
          <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3">
            <h5 className="text-apple-13 font-semibold text-primary">
              Update Remediation Status &amp; Re-Test Protocol
            </h5>
            {formError && (
              <div className="text-apple-12 text-cinnabar" data-testid="cap-form-error">{formError}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {allowed('mark_in_progress') && (
<button
                type="button"
                onClick={() => { setPanel('none'); run('mark_in_progress'); }}
                className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-apple-12 font-medium text-secondary hover:text-primary transition-colors text-center"
              >
                Mark In Progress
              </button>
)}
              {allowed('submit_validation') && (
<button
                type="button"
                onClick={() => { setFormError(null); setPanel('submit'); }}
                className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-apple-12 font-medium text-secondary hover:text-primary transition-colors text-center"
              >
                Submit for Validation
              </button>
)}
              {allowed('verify_close') && (
<button
                type="button"
                onClick={() => { setFormError(null); setPanel('verify'); }}
                className="p-2 rounded-xl bg-verdigris-subtle hover:opacity-85 text-verdigris text-apple-12 font-semibold transition-opacity text-center flex items-center justify-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2]" />
                <span>Verify &amp; Close</span>
              </button>
)}
              {allowed('fail_retest') && (
<button
                type="button"
                onClick={() => { setFormError(null); setPanel('fail'); }}
                className="p-2 rounded-xl bg-cinnabar-subtle hover:opacity-85 text-cinnabar text-apple-12 font-semibold transition-opacity text-center flex items-center justify-center gap-1"
              >
                <AlertCircle className="w-3.5 h-3.5 stroke-[2]" />
                <span>Fail Re-Test</span>
              </button>
)}
            </div>

            {panel === 'submit' && (
              <div className="space-y-2 pt-2 border-t border-hairline">
                <label className="block text-apple-12 text-secondary">Justification (required)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-xl border border-hairline bg-surface-elevated p-2 text-apple-12 text-primary" />
                <label className="block text-apple-12 text-secondary">Evidence refs (required, one per line)</label>
                <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} className="w-full rounded-xl border border-hairline bg-surface-elevated p-2 text-apple-12 text-primary" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => run('submit_validation')} className="px-3 py-1.5 rounded-lg bg-accent text-canvas text-apple-12 font-semibold">Submit</button>
                  <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12">Cancel</button>
                </div>
              </div>
            )}
            {panel === 'verify' && (
              <div className="space-y-2 pt-2 border-t border-hairline">
                <label className="block text-apple-12 text-secondary">Verification note (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-xl border border-hairline bg-surface-elevated p-2 text-apple-12 text-primary" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => run('verify_close')} className="px-3 py-1.5 rounded-lg bg-verdigris-subtle text-verdigris text-apple-12 font-semibold">Confirm close</button>
                  <button type="button" onClick={() => { setPanel('reject'); }} className="px-3 py-1.5 rounded-lg border border-cinnabar text-cinnabar text-apple-12 font-semibold">Reject instead</button>
                  <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12">Cancel</button>
                </div>
              </div>
            )}
            {panel === 'reject' && (
              <div className="space-y-2 pt-2 border-t border-hairline">
                <label className="block text-apple-12 text-secondary">Rejection reason (required)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-xl border border-hairline bg-surface-elevated p-2 text-apple-12 text-primary" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => run('reject')} className="px-3 py-1.5 rounded-lg bg-cinnabar-subtle text-cinnabar text-apple-12 font-semibold">Reject to in progress</button>
                  <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12">Cancel</button>
                </div>
              </div>
            )}
            {panel === 'fail' && (
              <div className="space-y-2 pt-2 border-t border-hairline">
                <label className="block text-apple-12 text-secondary">Fail re-test note (required)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full rounded-xl border border-hairline bg-surface-elevated p-2 text-apple-12 text-primary" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => run('fail_retest')} className="px-3 py-1.5 rounded-lg bg-cinnabar-subtle text-cinnabar text-apple-12 font-semibold">Confirm fail</button>
                  <button type="button" onClick={() => setPanel('none')} className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12">Cancel</button>
                </div>
              </div>
            )}
            <p className="text-apple-11 text-tertiary">
              Actions shown are those your designation may perform ({currentUser.role}). Org designations can reassign powers without code changes.
            </p>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center text-apple-13 text-secondary">
          No corrective action item selected.
        </div>
      )}
    </div>
  );
};
