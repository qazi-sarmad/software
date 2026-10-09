import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { ShieldCheck } from '../common/Icons';
import {
  AUDIT_FILE_TABS,
  AuditFileTab,
  buildPlanningCoverage,
  getGateSummary,
  getSignOffBlockers,
  getInitialAuditFileTab,
  getSignOffState,
} from '../../lib/auditFile';
import { PlanningTab } from './file/PlanningTab';
import { ExecutionTab } from './file/ExecutionTab';
import { ReviewTab } from './file/ReviewTab';

/**
 * Audit File: one permanent workspace per engagement.
 * Entry points (Gantt, CAP inspector, review comments) all call openInspector('audit_file', { engagement }).
 * The engagement is always re-read through useScopedData(), so scope applies and status is never stale.
 */
export const AuditFileModal: React.FC = () => {
  const { inspector, openInspector, signOffEngagement, currentUser } = useApp();
  const { scopedEngagements, scopedWorkpapers, scopedControls, scopedEntities, scopedObservations, scopedComments } = useScopedData();

  const requestedId: string | undefined = inspector.data?.engagement?.id;
  const engagement = requestedId ? scopedEngagements.find((e) => e.id === requestedId) : undefined;
  const [tab, setTab] = useState<AuditFileTab>(() => getInitialAuditFileTab(inspector.data));

  // Neutral state: does not reveal whether an out-of-scope engagement exists.
  if (!engagement) {
    return (
      <div className="p-6 text-center text-secondary" data-testid="audit-file-unavailable">
        Audit file not available.
      </div>
    );
  }

  const workpapers = scopedWorkpapers.filter((w) => w.engagementId === engagement.id);
  const entity = scopedEntities.find((e) => e.id === engagement.entityId);
  const coverage = buildPlanningCoverage(engagement, scopedControls, workpapers);
  const gate = getGateSummary(workpapers);
  const blockers = getSignOffBlockers(workpapers, scopedObservations, scopedComments);
  const signOff = getSignOffState(currentUser, engagement, gate, blockers);

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = AUDIT_FILE_TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight') setTab(AUDIT_FILE_TABS[(i + 1) % AUDIT_FILE_TABS.length].id);
    if (e.key === 'ArrowLeft') setTab(AUDIT_FILE_TABS[(i + AUDIT_FILE_TABS.length - 1) % AUDIT_FILE_TABS.length].id);
  };

  return (
    <div className="space-y-6" data-testid="audit-file">
      {/* File chrome */}
      <div className="p-5 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-apple-11 px-2 py-0.5 rounded bg-surface border border-hairline text-secondary">
              {engagement.id}
            </span>
            <span className="text-apple-11 font-semibold text-secondary uppercase" data-testid="audit-file-stage">
              {engagement.stage}
            </span>
          </div>
          {engagement.status === 'signed_off' && (
            <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Formally Signed-Off
            </span>
          )}
        </div>
        <h2 className="text-apple-17 font-bold text-primary">{engagement.title}</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-apple-11 text-secondary">
          <span className="capitalize">Status: {engagement.status.replace(/_/g, ' ')}</span>
          <span>•</span>
          <span>Due: {engagement.dueDate}</span>
          <span>•</span>
          <span>{workpapers.length} working papers</span>
        </div>
      </div>

      {/* In-file tab strip */}
      <div role="tablist" aria-label="Audit file sections" onKeyDown={onTabKey} className="grid grid-cols-3 border-b border-hairline">
        {AUDIT_FILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`af-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`af-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            data-testid={`audit-file-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`py-2.5 text-center border-b-2 transition-colors ${
              tab === t.id ? 'border-accent text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            <div className="text-apple-13 font-semibold">{t.label}</div>
            <div className="text-apple-11 text-tertiary">{t.caption}</div>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`af-panel-${tab}`} aria-labelledby={`af-tab-${tab}`}>
        {tab === 'planning' && <PlanningTab engagement={engagement} entity={entity} coverage={coverage} />}
        {tab === 'execution' && (
          <ExecutionTab
            workpapers={workpapers}
            highlightId={inspector.data?.workpaper?.id}
            onOpen={(id) => openInspector('workbench', { workpaperId: id })}
          />
        )}
        {tab === 'review' && (
          <ReviewTab engagement={engagement} gate={gate} signOff={signOff} onSignOff={() => signOffEngagement(engagement.id)} />
        )}
      </div>
    </div>
  );
};
