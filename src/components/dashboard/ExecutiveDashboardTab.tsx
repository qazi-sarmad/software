import React from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { CapRadialTracker } from './CapRadialTracker';
import { CapTable } from './CapTable';
import { EngagementGantt } from './EngagementGantt';
import { LedgerScrubBar } from './LedgerScrubBar';
import { HoverPreview } from '../common/HoverPreview';
import {
  Folder,
  ShieldCheck,
  AlertTriangle,
  FileCheck,
  Filter,
  RotateCcw,
} from '../common/Icons';

export const ExecutiveDashboardTab: React.FC = () => {
  const {
    currentUser,
    stats,
    filteredEngagements,
    scopedEntities,
    filteredCapItems,
  } = useScopedData();
  const filter = useFilterStore();
  const { setActiveTab, setSelectedEngagementId } = useApp();

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-fade-in">
      {/* Editorial Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-hairline pb-6">
        <div>
          <span className="text-apple-12 font-medium tracking-wide uppercase text-accent">
            Internal Audit &amp; Risk Governance OS
          </span>
          <h1 className="text-apple-28 font-bold text-primary tracking-tight mt-1">
            Executive Assurance Cockpit
          </h1>
          <p className="text-apple-15 text-secondary mt-1">
            Welcome back, {currentUser.name}.{' '}
            <span className="text-primary font-medium">{stats.greetingSubtitle}</span>
          </p>
        </div>

        {/* Global Filter Status & Reset */}
        {filter.hasActiveFilters() && (
          <div className="flex items-center gap-2 bg-accent-subtle border border-accent text-accent px-3 py-1.5 rounded-xl text-apple-12 shadow-xs">
            <Filter className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>
              Active Filter:{' '}
              <strong>
                {filter.department || filter.status || filter.severity || filter.searchQuery}
              </strong>
            </span>
            <button
              onClick={() => filter.clearFilters()}
              className="ml-2 hover:opacity-80 transition-opacity p-0.5"
              title="Clear active filter"
            >
              <RotateCcw className="w-3 h-3 stroke-[1.5]" />
            </button>
          </div>
        )}
      </div>

      {/* 4D Ledger Scrub Bar (Task 6 Differentiator & Task 1) */}
      <LedgerScrubBar />

      {/* Metric Cards Row with Apple-tier Serif Numerals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Scoped Entities */}
        <HoverPreview
          content={{
            title: `${stats.totalEntities} Scoped Audit Entities`,
            category: 'Audit Universe Coverage',
            subtitle: `${stats.highRiskEntities} Rated High Inherent Risk`,
            status: 'Scoped Viewpoint',
            statusType: 'neutral',
            hint: 'Click to open Universe & SIRA',
          }}
          onClick={() => setActiveTab('universe')}
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Scoped Entities</span>
              <Folder className="w-4 h-4 stroke-[1.5] text-accent" />
            </div>
            <div className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
              {stats.totalEntities}
            </div>
            <div className="text-apple-11 text-secondary">
              {stats.highRiskEntities} High Risk Profile
            </div>
          </div>
        </HoverPreview>

        {/* Engagements in Progress */}
        <HoverPreview
          content={{
            title: `${stats.inProgressEngagements} Engagements in Progress`,
            category: 'Fieldwork Status',
            subtitle: `${stats.completedEngagements} Completed and Signed-off`,
            status: 'Fieldwork Stage',
            statusType: 'neutral',
            hint: 'Click to open Audit Plan',
          }}
          onClick={() => setActiveTab('plan')}
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>In Fieldwork</span>
              <span className="w-2 h-2 rounded-full bg-accent" />
            </div>
            <div className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
              {stats.inProgressEngagements}
            </div>
            <div className="text-apple-11 text-secondary">
              {stats.completedEngagements} Completed / Sealed
            </div>
          </div>
        </HoverPreview>

        {/* Open Audit Issues */}
        <HoverPreview
          content={{
            title: `${stats.openIssues} Open Audit Issues`,
            category: 'Findings Register',
            subtitle: `${stats.criticalIssues} High/Critical Severity Escalations`,
            status: stats.criticalIssues > 0 ? 'Action Required' : 'On Track',
            statusType: stats.criticalIssues > 0 ? 'cinnabar' : 'verdigris',
            hint: 'Click to open Issues Register',
          }}
          onClick={() => setActiveTab('issues')}
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Open Findings</span>
              <AlertTriangle className="w-4 h-4 stroke-[1.5] text-cinnabar" />
            </div>
            <div className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
              {stats.openIssues}
            </div>
            <div className="text-apple-11 text-secondary">
              <span className="text-cinnabar font-semibold">{stats.criticalIssues} Critical</span>{' '}
              Escalated
            </div>
          </div>
        </HoverPreview>

        {/* Sealed Working Papers */}
        <HoverPreview
          content={{
            title: `${stats.sealedWorkpapers} Working Papers Cryptographically Sealed`,
            category: 'Ledger Hash Attestation',
            subtitle: 'Verified by reviewer four-eyes protocol',
            status: 'Ledger Attested',
            statusType: 'verdigris',
            hint: 'Click to open Workbench',
          }}
          onClick={() => setActiveTab('plan')}
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Sealed Papers</span>
              <FileCheck className="w-4 h-4 stroke-[1.5] text-verdigris" />
            </div>
            <div className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
              {stats.sealedWorkpapers}
            </div>
            <div className="text-apple-11 text-verdigris font-medium flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Attested on Hash-Chain</span>
            </div>
          </div>
        </HoverPreview>
      </div>

      {/* Engagement Gantt & Horizon Warp (§ 3.4: inertial pan, today marker, depth falloff, bar states) */}
      <EngagementGantt
        engagements={filteredEngagements}
        onSelectEngagement={(id) => {
          setSelectedEngagementId(id);
        }}
      />

      {/* CAP Radial Tracker (§ 3.4: replaces Sunburst with D3 radial chart, outer ring severity, overdue arc) */}
      <CapRadialTracker
        capDeptMap={stats.capDeptMap}
        totalCapCount={stats.totalCapCount}
        openCapCount={stats.openCapCount}
        overdueCapCount={stats.overdueCapCount}
      />

      {/* CAP Table below chart (§ 3.4 requirement: id, action, owner, dept, severity, due date, aging, status, retest) */}
      <CapTable capItems={filteredCapItems} />
    </div>
  );
};
