import React, { useMemo } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { CapRadialTracker } from './CapRadialTracker';
import { CapTable } from './CapTable';
import { EngagementGantt } from './EngagementGantt';
import { BoardPackPanel } from '../pending/BoardPackPanel';
import { CapabilityLibraryPanel } from './CapabilityLibraryPanel';
import { HoverPreview } from '../common/HoverPreview';
import { DrilldownPanel } from '../explain/DrilldownPanel';
import { StandardsAffordance } from '../explain/StandardsAffordance';
import { IntegrityAlarmBanner } from './IntegrityAlarmBanner';
import { ActivitySpine } from './ActivitySpine';
import { useDrilldown } from '../../hooks/useDrilldown';
import {
  engagementsInProgress,
  openCaps,
  openIssues,
  sealedWorkpapers,
  type DrillSource,
  type DrillTarget,
} from '../../lib/drilldown';
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
    scopedIssues,
    scopedWorkpapers,
    scopedObservations,
    filteredCapItems,
    scopedComments,
  } = useScopedData();
  const filter = useFilterStore();
  const { setActiveTab, setSelectedEngagementId, openInspector, applyPlanItemDates } = useApp();
  const drill = useDrilldown();

  // Every dashboard number is counted from these already-scoped, already-filtered rows, and the
  // drilldown reads the SAME rows, so a number and its drilldown can never disagree (E5/U1).
  const drillSource: DrillSource = useMemo(
    () => ({
      entities: scopedEntities,
      engagements: filteredEngagements,
      issues: scopedIssues,
      workpapers: scopedWorkpapers,
      caps: filteredCapItems,
      observations: scopedObservations,
      comments: scopedComments,
    }),
    [scopedEntities, filteredEngagements, scopedIssues, scopedWorkpapers, filteredCapItems, scopedObservations, scopedComments]
  );

  // Open a drilldown row in the existing record drilldown (RecordView / FloatingWindowManager).
  const openDrillRecord = (kind: DrillTarget['kind'], id: string) => {
    switch (kind) {
      case 'engagements':
        setSelectedEngagementId(id);
        openInspector('audit_file', { engagement: { id } });
        break;
      case 'workpapers':
        openInspector('workbench', { workpaperId: id });
        break;
      case 'caps': {
        const cap = filteredCapItems.find((c) => c.id === id);
        if (cap) openInspector('cap_inspector', { cap, department: cap.department });
        break;
      }
      case 'observations': {
        const obs = scopedObservations.find((o) => o.id === id);
        if (obs) openInspector('observation', obs);
        break;
      }
      case 'issues':
        setActiveTab('issues');
        break;
      case 'entities':
        setActiveTab('universe');
        break;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8 animate-fade-in">
      {/* Editorial Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-hairline pb-6">
        <div>
          <span className="text-apple-12 font-medium tracking-wide uppercase text-accent">
            Audit Platform
          </span>
          <h1 className="text-apple-28 font-bold text-primary tracking-tight mt-1">
            Executive Assurance Cockpit
          </h1>
          <p className="text-apple-15 text-secondary mt-1">
            Welcome back, {currentUser.name}.{' '}
            <span className="text-primary font-medium">{stats.greetingSubtitle}</span>
          </p>
          <StandardsAffordance kind="screen" target="DB-01" screenId="DB-01" element="standards" className="mt-3" />
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

      {/* T7: the tamper alarm, where a human already looks. Non-blocking, one line, links to the
          integrity surface. It renders nothing when every recorded root still verifies. */}
      <IntegrityAlarmBanner onOpen={() => openInspector('org_control', { tab: 'integrity' })} />

      {/* Metric Cards Row with Apple-tier Serif Numerals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Scoped Entities */}
        <HoverPreview
          content={{
            title: `${stats.totalEntities} Scoped Audit Entities`,
            category: 'Audit Universe Coverage',
            subtitle: `${stats.highRiskEntities} Rated High Inherent Risk`,
            status: 'Scoped view',
            statusType: 'neutral',
            hint: 'Click to list the scoped entities, or open Universe & SIRA',
          }}
          onClick={() =>
            drill.open({
              kind: 'entities',
              label: 'Scoped Audit Entities',
              filterSummary: 'Entities within your scope and the active universe.',
            })
          }
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Scoped Entities</span>
              <Folder className="w-4 h-4 stroke-[1.5] text-accent" />
            </div>
            <div data-testid="DB-01-tile-entities" data-drill-kind="entities" className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
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
            subtitle: `${stats.completedEngagements} Completed and sealed`,
            status: 'Fieldwork Stage',
            statusType: 'neutral',
            hint: 'Click to list the engagements in fieldwork',
          }}
          onClick={() =>
            drill.open({
              kind: 'engagements',
              label: 'Engagements in Fieldwork',
              filterSummary: 'Status is in progress, within your scope and the active filters.',
            })
          }
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>In Fieldwork</span>
              <span className="w-2 h-2 rounded-full bg-accent" />
            </div>
            <div data-testid="DB-01-tile-engagements" data-drill-kind="engagements" className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
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
            category: 'Issues Register',
            subtitle: `${stats.criticalIssues} High/Critical Severity Escalations`,
            status: stats.criticalIssues > 0 ? 'Action Required' : 'On Track',
            statusType: stats.criticalIssues > 0 ? 'cinnabar' : 'verdigris',
            hint: 'Click to list the open issues',
          }}
          onClick={() =>
            drill.open({
              kind: 'issues',
              label: 'Open Audit Issues',
              filterSummary: 'Status is not closed or remediated, within your scope.',
            })
          }
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Open Issues</span>
              <AlertTriangle className="w-4 h-4 stroke-[1.5] text-cinnabar" />
            </div>
            <div data-testid="DB-01-tile-issues" data-drill-kind="issues" className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
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
            title: `${stats.sealedWorkpapers} Working Papers Sealed`,
            category: 'Ledger Verification',
            subtitle: 'Verified by a second reviewer',
            status: 'Verified',
            statusType: 'verdigris',
            hint: 'Click to list the sealed working papers',
          }}
          onClick={() =>
            drill.open({
              kind: 'workpapers',
              label: 'Sealed Working Papers',
              filterSummary: 'Working papers sealed within your scope.',
            })
          }
        >
          <div className="p-5 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer space-y-1">
            <div className="flex items-center justify-between text-secondary text-apple-12 font-medium">
              <span>Sealed Papers</span>
              <FileCheck className="w-4 h-4 stroke-[1.5] text-verdigris" />
            </div>
            <div data-testid="DB-01-tile-workpapers" data-drill-kind="workpapers" className="font-serif-numeral text-apple-40 font-bold text-primary tabular-nums">
              {stats.sealedWorkpapers}
            </div>
            <div className="text-apple-11 text-verdigris font-medium flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Cryptographically verified</span>
            </div>
          </div>
        </HoverPreview>
      </div>

      {/* The exact records behind the number just clicked (E5/U1). Non-blocking: a complementary
          panel, never a modal. The hash deep-links the state (`#drill=engagements`). */}
      {drill.target && (
        <DrilldownPanel
          target={drill.target}
          source={drillSource}
          screenId="DB-01"
          onOpenRecord={openDrillRecord}
          onClose={drill.close}
        />
      )}

      {/* Engagement Gantt & Horizon Warp (§ 3.4: inertial pan, today marker, depth falloff, bar states) */}
      <EngagementGantt
        engagements={filteredEngagements}
        onSelectEngagement={(id) => {
          setSelectedEngagementId(id);
        }}
        onRescheduled={({ engagementId, newStart, newDue }) =>
          applyPlanItemDates(engagementId, newStart, newDue)
        }
      />

      {/* CAP Radial Tracker (§ 3.4: replaces Sunburst with D3 radial chart, outer ring severity, overdue arc) */}
      <CapRadialTracker
        capDeptMap={stats.capDeptMap}
        totalCapCount={stats.totalCapCount}
        openCapCount={stats.openCapCount}
        overdueCapCount={stats.overdueCapCount}
      />

      {/* CAP Table below chart (§ 3.4 requirement: id, action, owner, dept, severity, due date, aging, status) */}
      <CapTable capItems={filteredCapItems} />

      {/* Board Pack panel (F10): pack history, Generate, Open and the drillable web view. */}
      <BoardPackPanel />

      {/* Deterministic capability library (D1-D4): the twenty capabilities over the data in scope. */}
      <CapabilityLibraryPanel />

      {/* The live activity spine (U4): a quiet stream of what is happening, on the existing
          liveSync transport (Realtime when available, a bounded poll otherwise). */}
      <ActivitySpine />
    </div>
  );
};
