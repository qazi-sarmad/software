import React, { useMemo, useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { CapRegisterPanel } from '../audit/CapRegisterPanel';
import { IssueHeatMatrix } from './IssueHeatMatrix';
import { getOrgLocalToday } from '../../lib/orgDate';
import { PatternsPanel } from './PatternsPanel';
import { AuditIssue, Severity } from '../../types';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  Plus,
  ArrowRight,
} from '../common/Icons';

export const IssuesRegisterTab: React.FC = () => {
  const { filteredIssues, scopedEngagements, can, currentUser } = useScopedData();
  const filter = useFilterStore();
  const { openInspector, selectedEngagementId } = useApp();
  // WK-10 (F15): the register carries a "Patterns" view beside the issue list.
  const [view, setView] = useState<'register' | 'patterns'>('register');

  // D10: the CAP register is per engagement (§16.1 "CAPs are created from the final report"). The
  // tab is org-wide, so it offers the engagements in scope and renders the register for the chosen
  // one. The register itself (listCaps, update_cap, close_cap) lives in src/data/caps.ts and is
  // reused unchanged, so the CAP status vocabulary stays the single set from 0038 (D-6D-CAP).
  const engagements = useMemo(
    () => scopedEngagements.slice().sort((a, b) => a.title.localeCompare(b.title)),
    [scopedEngagements]
  );
  const [capEngagementId, setCapEngagementId] = useState<string | null>(selectedEngagementId);
  const activeCapEngagementId = useMemo(() => {
    if (capEngagementId && engagements.some((e) => e.id === capEngagementId)) return capEngagementId;
    return engagements[0]?.id ?? null;
  }, [capEngagementId, engagements]);

  const getSeverityBadge = (severity: Severity) => {
    switch (severity) {
      case 'critical':
        return 'text-cinnabar bg-cinnabar-subtle border-cinnabar';
      case 'high':
        return 'text-cinnabar bg-cinnabar-subtle';
      case 'medium':
        return 'text-primary bg-surface-elevated';
      default:
        return 'text-secondary bg-surface-hover';
    }
  };

  const getStatusBadge = (status: AuditIssue['status']) => {
    switch (status) {
      case 'closed':
      case 'remediated':
        return 'text-verdigris bg-verdigris-subtle';
      case 'overdue':
        return 'text-cinnabar bg-cinnabar-subtle';
      default:
        return 'text-secondary bg-surface-hover';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-apple-28 font-bold text-primary tracking-tight">Issues &amp; CAP Register</h1>
          <p className="text-apple-15 text-secondary mt-1">
            Tracking concluded findings, remedial commitments and management action plans
          </p>
          <StandardsAffordance kind="screen" target="IR-01" screenId="IR-01" element="standards" className="mt-2" />
        </div>

        {/* Action Gate: only non-auditees can raise observations */}
        {can('raise_observation').allowed && (
          <button
            onClick={() => openInspector('observation', null)}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white font-medium text-apple-13 rounded-xl hover:opacity-90 transition-opacity shadow-xs"
          >
            <Plus className="w-4 h-4 stroke-[1.5]" />
            <span>Raise Observation</span>
          </button>
        )}
      </div>

      {/* WK-10 (F15): the Patterns view sits beside the issue register. */}
      <div className="flex items-center gap-1 rounded-xl border border-hairline bg-surface p-1 w-fit" role="tablist" aria-label="Issues and patterns">
        {([
          ['register', 'Issue register'],
          ['patterns', 'Patterns'],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            data-testid={`issues-view-${v}`}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold ${
              view === v ? 'bg-surface-hover text-primary' : 'text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'patterns' ? (
        // WK-10 (F15): a cluster, node or heat-map cell opens the original sealed finding.
        <PatternsPanel onOpenFinding={(findingId) => openInspector('finding', { findingId })} />
      ) : (
        <>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-4 rounded-2xl border border-hairline shadow-apple">
        <div className="flex items-center gap-3 flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-secondary stroke-[1.5]" />
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(e) => filter.setSearchQuery(e.target.value)}
            placeholder="Search findings by title, department, description..."
            className="w-full bg-transparent text-apple-13 text-primary placeholder:text-tertiary outline-none border-none"
          />
        </div>

        {/* Quick Severity Filter Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-surface-elevated rounded-xl border border-hairline">
          {['all', 'critical', 'high', 'medium'].map((sev) => {
            const isSelected = sev === 'all' ? !filter.severity : filter.severity === sev;
            return (
              <button
                key={sev}
                onClick={() => filter.setSeverity(sev === 'all' ? null : sev)}
                className={`px-3 py-1 text-apple-12 font-medium rounded-lg capitalize transition-colors ${
                  isSelected
                    ? 'bg-surface text-primary shadow-xs'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {sev}
              </button>
            );
          })}
        </div>
      </div>

      {/* WP-V slice 1: a severity × aging heat matrix beside the register table. */}
      <IssueHeatMatrix
        issues={filteredIssues}
        asOf={getOrgLocalToday()}
        onPickSeverity={(sev) => filter.setSeverity(sev)}
      />

      {/* Issues Table */}
      <div className="bg-surface border border-hairline rounded-2xl shadow-apple overflow-hidden">
        <div className="grid grid-cols-12 px-6 py-3 border-b border-hairline bg-surface-elevated text-apple-11 font-semibold text-secondary uppercase tracking-wider">
          <div className="col-span-5">Issue</div>
          <div className="col-span-2">Department</div>
          <div className="col-span-2">Severity</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Due Date</div>
        </div>

        <div className="divide-y divide-hairline">
          {filteredIssues.length === 0 ? (
            <div className="py-12 text-center text-apple-13 text-secondary">
              No audit issues match your current scoped filters.
            </div>
          ) : (
            filteredIssues.map((issue) => {
              const previewData = {
                title: issue.title,
                category: `${issue.department} • Finding #${issue.id}`,
                subtitle: issue.description,
                status: issue.severity.toUpperCase(),
                statusType:
                  issue.severity === 'critical'
                    ? ('cinnabar' as const)
                    : issue.severity === 'high'
                    ? ('neutral' as const)
                    : ('neutral' as const),
                dueDate: issue.dueDate,
                owner: issue.ownerId,
                hint: 'Click to inspect issue details',
              };

              return (
                <HoverPreview key={issue.id} content={previewData} className="w-full">
                  <div
                    onClick={() => openInspector('observation', { issue })}
                    className="grid grid-cols-12 px-6 py-4 items-center hover:bg-surface-hover transition-colors cursor-pointer"
                  >
                    <div className="col-span-5 pr-4">
                      <div className="text-apple-13 font-semibold text-primary truncate">
                        {issue.title}
                      </div>
                      <div className="text-apple-12 text-secondary line-clamp-1 mt-0.5">
                        {issue.description}
                      </div>
                    </div>
                    <div className="col-span-2 text-apple-12 font-medium text-secondary">
                      {issue.department}
                    </div>
                    <div className="col-span-2">
                      <span
                        className={`px-2 py-0.5 rounded text-apple-11 font-semibold uppercase ${getSeverityBadge(
                          issue.severity
                        )}`}
                      >
                        {issue.severity}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span
                        className={`px-2 py-0.5 rounded text-apple-11 font-medium capitalize ${getStatusBadge(
                          issue.status
                        )}`}
                      >
                        {issue.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="col-span-1 text-right text-apple-12 text-primary font-medium tabular-nums">
                      {issue.dueDate}
                    </div>
                  </div>
                </HoverPreview>
              );
            })
          )}
        </div>
      </div>

      {/* D10: CAP register for the selected engagement (spec §16). Loaded from src/data/caps.ts. */}
      <div className="bg-surface border border-hairline rounded-2xl shadow-apple p-6" data-testid="issues-cap-register-section">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-apple-16 font-semibold text-primary">Corrective Action Plan register</h2>
            <p className="text-apple-12 text-secondary mt-0.5">
              Every finding or issue gets one CAP before the report can freeze (§16.1).
            </p>
          </div>
          {engagements.length > 0 && (
            <label className="flex items-center gap-2 text-apple-12 text-secondary">
              <span>Engagement</span>
              <select
                data-testid="cap-engagement-picker"
                value={activeCapEngagementId ?? ''}
                onChange={(e) => setCapEngagementId(e.target.value || null)}
                className="rounded-lg border border-hairline bg-surface px-3 py-1.5 text-apple-13 text-primary"
              >
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {activeCapEngagementId ? (
          <CapRegisterPanel engagementId={activeCapEngagementId} />
        ) : (
          <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="cap-no-engagement">
            No engagements are in scope, so there is no CAP register to show. Create or deploy an
            engagement first.
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};
