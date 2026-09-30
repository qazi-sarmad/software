import React, { useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
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
  const { filteredIssues, can, currentUser } = useScopedData();
  const filter = useFilterStore();
  const { openInspector } = useApp();

  const getSeverityBadge = (severity: Severity) => {
    switch (severity) {
      case 'critical':
        return 'text-cinnabar bg-cinnabar-subtle border-cinnabar';
      case 'high':
        return 'text-amber bg-amber-subtle border-amber';
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
          <h1 className="text-apple-28 font-bold text-primary tracking-tight">Audit Findings &amp; Issues Register</h1>
          <p className="text-apple-15 text-secondary mt-1">
            Tracking remedial commitments, management action plans, and regulatory observations
          </p>
        </div>

        {/* Action Gate: only non-auditees can raise observations */}
        {can('raise_observation').allowed && (
          <button
            onClick={() => openInspector('observation', null)}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white font-medium text-apple-13 rounded-xl hover:opacity-90 transition-opacity shadow-xs"
          >
            <Plus className="w-4 h-4 stroke-[1.5]" />
            <span>Raise Finding</span>
          </button>
        )}
      </div>

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

      {/* Issues Table */}
      <div className="bg-surface border border-hairline rounded-2xl shadow-apple overflow-hidden">
        <div className="grid grid-cols-12 px-6 py-3 border-b border-hairline bg-surface-elevated text-apple-11 font-semibold text-secondary uppercase tracking-wider">
          <div className="col-span-5">Issue / Finding</div>
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
                    ? ('amber' as const)
                    : ('neutral' as const),
                dueDate: issue.dueDate,
                owner: issue.ownerId,
                hint: 'Click to inspect finding details',
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
    </div>
  );
};
