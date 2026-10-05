import React, { useState } from 'react';
import { AuditCapItem, CapStatus, RetestStatus, Severity } from '../../types';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { isCapOverdue } from '../../lib/orgDate';
import { canChangeCapDueDate } from '../../lib/access';
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
  const { updateCapStatus, openInspector, setActiveTab, setSelectedEngagementId, currentUser, changeCapDueDate } = useApp();
  const { scopedCapItems, scopedEngagements } = useScopedData();

  // If a single CAP was clicked, show detail or list
  const activeDepartment = data?.department || (data?.cap ? data.cap.department : null);
  const baseItems = data?.caps
    ? data.caps
    : data?.cap
    ? [data.cap]
    : activeDepartment
    ? scopedCapItems.filter((c) => c.department === activeDepartment)
    : scopedCapItems;
  // Always show the live CAP (the inspector payload can be a stale snapshot).
  const items = baseItems.map((c) => scopedCapItems.find((s) => s.id === c.id) ?? c);

  const [selectedCapId, setSelectedCapId] = useState<string | null>(
    data?.cap ? data.cap.id : items[0]?.id || null
  );

  const activeCap = items.find((c) => c.id === selectedCapId) || items[0];

  const [editingDue, setEditingDue] = useState(false);
  const [dueDraft, setDueDraft] = useState('');
  const [dueReason, setDueReason] = useState('');
  const [dueError, setDueError] = useState<string | null>(null);
  const canEditDue = canChangeCapDueDate(currentUser.role) && activeCap?.status !== 'Closed';

  const saveDue = () => {
    if (!activeCap) return;
    const res = changeCapDueDate(activeCap.id, dueDraft, dueReason);
    if (res.ok) {
      setEditingDue(false);
      setDueError(null);
      setDueReason('');
    } else {
      setDueError(res.message);
    }
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
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold uppercase bg-amber-subtle text-amber border border-amber">
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
                {canEditDue && !editingDue && (
                  <button
                    type="button"
                    data-testid="cap-due-edit"
                    onClick={() => {
                      setDueDraft(activeCap.dueDate);
                      setDueError(null);
                      setEditingDue(true);
                    }}
                    className="mt-1.5 text-apple-11 font-medium text-accent hover:underline"
                  >
                    Change due date
                  </button>
                )}
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

            {editingDue && canEditDue && (
              <div className="p-3.5 rounded-xl bg-surface border border-hairline space-y-2" data-testid="cap-due-editor">
                <label className="block text-apple-11 text-tertiary" htmlFor="cap-due-input">
                  New target due date
                </label>
                <input
                  id="cap-due-input"
                  type="date"
                  value={dueDraft}
                  onChange={(e) => setDueDraft(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-13 text-primary"
                />
                <input
                  type="text"
                  value={dueReason}
                  onChange={(e) => setDueReason(e.target.value)}
                  placeholder="Reason (optional)"
                  aria-label="Reason for due date change"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-hairline text-apple-13 text-primary"
                />
                {dueError && (
                  <div role="alert" className="text-apple-12 text-cinnabar">
                    {dueError}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="cap-due-save"
                    onClick={saveDue}
                    className="px-3 py-1.5 rounded-xl bg-accent text-canvas text-apple-12 font-medium"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingDue(false)}
                    className="px-3 py-1.5 rounded-xl bg-surface-elevated border border-hairline text-apple-12 text-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activeCap.dueDateHistory && activeCap.dueDateHistory.length > 0 && (
              <div className="pt-2 border-t border-hairline space-y-1.5" data-testid="cap-due-history">
                <div className="text-apple-11 font-semibold text-primary uppercase">Due-date history</div>
                {[...activeCap.dueDateHistory].reverse().map((h) => (
                  <div key={h.id} className="text-apple-12 text-secondary">
                    {h.oldDueDate} → {h.newDueDate} · {h.changedByName} · {h.changedOnOrgLocal}
                    {h.reason ? ` · ${h.reason}` : ''}
                  </div>
                ))}
              </div>
            )}

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
                    setActiveTab('reports');
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent-subtle hover:bg-accent-hover text-accent text-apple-12 font-medium transition-colors shrink-0"
              >
                <span>View Audit Report</span>
                <ExternalLink className="w-3.5 h-3.5 stroke-[1.5]" />
              </button>
            </div>
          </div>

          {/* Remediation Lifecycle Management Actions */}
          <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3">
            <h5 className="text-apple-13 font-semibold text-primary">
              Update Remediation Status &amp; Re-Test Protocol
            </h5>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => updateCapStatus(activeCap.id, 'In progress', 'In retest')}
                className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-apple-12 font-medium text-secondary hover:text-primary transition-colors text-center"
              >
                Mark In Progress
              </button>
              <button
                onClick={() => updateCapStatus(activeCap.id, 'Pending validation', 'In retest')}
                className="p-2 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-apple-12 font-medium text-secondary hover:text-primary transition-colors text-center"
              >
                Submit for Validation
              </button>
              <button
                onClick={() => updateCapStatus(activeCap.id, 'Closed', 'Passed')}
                className="p-2 rounded-xl bg-verdigris-subtle hover:opacity-85 text-verdigris text-apple-12 font-semibold transition-opacity text-center flex items-center justify-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2]" />
                <span>Verify &amp; Close</span>
              </button>
              <button
                onClick={() => updateCapStatus(activeCap.id, 'Overdue', 'Failed')}
                className="p-2 rounded-xl bg-cinnabar-subtle hover:opacity-85 text-cinnabar text-apple-12 font-semibold transition-opacity text-center flex items-center justify-center gap-1"
              >
                <AlertCircle className="w-3.5 h-3.5 stroke-[2]" />
                <span>Fail Re-Test</span>
              </button>
            </div>
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
