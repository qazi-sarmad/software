import React, { useState } from 'react';
import { AuditCapItem, CapStatus, RetestStatus, Severity } from '../../types';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
} from '../common/Icons';

interface CapTableProps {
  capItems: AuditCapItem[];
}

export const CapTable: React.FC<CapTableProps> = ({ capItems }) => {
  const filter = useFilterStore();
  const { openInspector, updateCapStatus } = useApp();
  const [sortField, setSortField] = useState<keyof AuditCapItem>('agingDays');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const handleSort = (field: keyof AuditCapItem) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // Default descending for audit urgency
    }
  };

  const sortedItems = [...capItems].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (typeof aVal === 'string') {
      return sortAsc
        ? (aVal as string).localeCompare(bVal as string)
        : (bVal as string).localeCompare(aVal as string);
    }
    return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

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

  const getStatusBadge = (status: CapStatus, dueDate: string) => {
    const isOverdue = status === 'Overdue' || (status !== 'Closed' && dueDate < '2026-09-30');
    if (isOverdue) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar">
          <span className="w-1.5 h-1.5 rounded-full bg-cinnabar animate-pulse" />
          Overdue
        </span>
      );
    }
    switch (status) {
      case 'Closed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-apple-11 font-medium bg-verdigris-subtle text-verdigris">
            <CheckCircle2 className="w-3 h-3 stroke-[2]" />
            Closed
          </span>
        );
      case 'Pending validation':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-apple-11 font-medium bg-accent-subtle text-accent">
            <Clock className="w-3 h-3 stroke-[2]" />
            Pending Validation
          </span>
        );
      case 'In progress':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-apple-11 font-medium bg-amber-subtle text-amber">
            In Progress
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-surface-elevated text-secondary border border-hairline">
            Open
          </span>
        );
    }
  };

  const getRetestBadge = (retest: RetestStatus) => {
    switch (retest) {
      case 'Passed':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris">
            Passed ✓
          </span>
        );
      case 'Failed':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar">
            Failed ✗
          </span>
        );
      case 'In retest':
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 font-medium bg-amber-subtle text-amber">
            In Retest
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-apple-11 text-tertiary">
            Not Tested
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-6 shadow-apple space-y-4">
      {/* Header with Search and Clear Filter Chip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-apple-17 font-bold text-primary">
              Corrective Action Plans Register
            </h3>
            <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-surface-elevated text-secondary border border-hairline tabular-nums">
              {sortedItems.length} Actions
            </span>
          </div>
          <p className="text-apple-12 text-secondary mt-0.5">
            Operational remediation commitments, aging days, and independent re-test verification
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-secondary absolute left-3 top-2.5 stroke-[1.5]" />
            <input
              type="text"
              placeholder="Search actions or owner…"
              value={filter.searchQuery}
              onChange={(e) => filter.setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-apple-12 rounded-xl bg-surface-elevated border border-hairline text-primary placeholder:text-tertiary outline-none focus:border-accent w-48 sm:w-56"
            />
          </div>

          {filter.hasActiveFilters() && (
            <button
              onClick={() => filter.clearFilters()}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-accent-subtle border border-accent text-accent text-apple-11 font-medium hover:opacity-85 transition-opacity"
            >
              <RotateCcw className="w-3 h-3 stroke-[1.5]" />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      </div>

      {/* Cross-Filter Pills */}
      {filter.hasActiveFilters() && (
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-2 border-b border-hairline text-apple-11">
          <span className="text-tertiary">Active criteria:</span>
          {filter.department && (
            <span className="px-2 py-0.5 rounded-lg bg-surface-elevated border border-hairline text-primary flex items-center gap-1">
              <span>Department: <strong>{filter.department}</strong></span>
              <button onClick={() => filter.setDepartment(null)} className="hover:text-cinnabar">×</button>
            </span>
          )}
          {filter.severity && (
            <span className="px-2 py-0.5 rounded-lg bg-surface-elevated border border-hairline text-primary flex items-center gap-1">
              <span>Severity: <strong>{filter.severity}</strong></span>
              <button onClick={() => filter.setSeverity(null)} className="hover:text-cinnabar">×</button>
            </span>
          )}
          {filter.status && (
            <span className="px-2 py-0.5 rounded-lg bg-surface-elevated border border-hairline text-primary flex items-center gap-1">
              <span>Status: <strong>{filter.status}</strong></span>
              <button onClick={() => filter.setStatus(null)} className="hover:text-cinnabar">×</button>
            </span>
          )}
        </div>
      )}

      {/* Table (§ 3.4 requirements: id, action, owner, department, severity, due date, aging in days, status, re-test status) */}
      <div className="overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full text-left text-apple-12 border-collapse">
          <thead>
            <tr className="bg-surface-elevated border-b border-hairline text-secondary text-apple-11 font-semibold uppercase tracking-wider select-none">
              <th
                onClick={() => handleSort('id')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                ID {sortField === 'id' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('action')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Remediation Action {sortField === 'action' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('department')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Department {sortField === 'department' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('owner')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Action Owner {sortField === 'owner' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('severity')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Severity {sortField === 'severity' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('dueDate')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Due Date {sortField === 'dueDate' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('agingDays')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors text-right"
              >
                Aging (Days) {sortField === 'agingDays' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('status')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Status {sortField === 'status' && (sortAsc ? '↑' : '↓')}
              </th>
              <th
                onClick={() => handleSort('retestStatus')}
                className="py-3 px-3 cursor-pointer hover:text-primary transition-colors"
              >
                Re-Test {sortField === 'retestStatus' && (sortAsc ? '↑' : '↓')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {sortedItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-apple-12 text-secondary">
                  No corrective actions match the current scoped filter criteria.
                </td>
              </tr>
            ) : (
              sortedItems.map((item) => {
                const previewContent = {
                  title: `${item.id}: ${item.title}`,
                  category: `${item.department} Remediation Plan`,
                  subtitle: item.action,
                  status: item.status,
                  statusType:
                    item.status === 'Overdue' || item.dueDate < '2026-09-30'
                      ? ('cinnabar' as const)
                      : item.status === 'Closed'
                      ? ('verdigris' as const)
                      : ('amber' as const),
                  owner: item.owner,
                  dueDate: item.dueDate,
                  hint: 'Click to open full remediation inspector',
                };

                return (
                  <tr
                    key={item.id}
                    onClick={() =>
                      openInspector('cap_inspector', {
                        cap: item,
                        department: item.department,
                      })
                    }
                    className="hover:bg-surface-hover transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-3 font-mono font-medium text-accent truncate">
                      {item.id}
                    </td>
                    <td className="py-3 px-3 font-medium text-primary max-w-xs truncate">
                      <HoverPreview content={previewContent} className="inline-block truncate max-w-xs">
                        <span>{item.title}</span>
                      </HoverPreview>
                    </td>
                    <td className="py-3 px-3 text-secondary truncate">
                      {item.department}
                    </td>
                    <td className="py-3 px-3 text-primary truncate">
                      {item.owner}
                    </td>
                    <td className="py-3 px-3 shrink-0">
                      {getSeverityBadge(item.severity)}
                    </td>
                    <td className="py-3 px-3 text-secondary tabular-nums truncate">
                      {item.dueDate}
                    </td>
                    <td className="py-3 px-3 text-right font-serif-numeral font-bold text-primary tabular-nums">
                      {item.agingDays} d
                    </td>
                    <td className="py-3 px-3 shrink-0">
                      {getStatusBadge(item.status, item.dueDate)}
                    </td>
                    <td className="py-3 px-3 shrink-0">
                      {getRetestBadge(item.retestStatus)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
