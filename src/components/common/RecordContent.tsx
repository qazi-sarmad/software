import React, { Suspense, lazy } from 'react';
import type { InspectorType } from '../../context/AppContext';

/**
 * The content of a record view, shared by the floating window (App shell) and the full-page
 * `/view/:recordType/:id` route (H3b/H3c). Lazy imports live here so both entry points
 * code-split identically. No overlay is rendered here: the caller decides full-page vs window.
 */
const ObservationDrilldown = lazy(() => import('../issues/ObservationDrilldown').then((m) => ({ default: m.ObservationDrilldown })));
const EntitySiraRcmModal = lazy(() => import('../universe/EntitySiraRcmModal').then((m) => ({ default: m.EntitySiraRcmModal })));
const AuditFileModal = lazy(() => import('../audit/AuditFileModal').then((m) => ({ default: m.AuditFileModal })));
const PaperWorkbenchModal = lazy(() => import('../audit/PaperWorkbenchModal').then((m) => ({ default: m.PaperWorkbenchModal })));
const GlassBoxShareModal = lazy(() => import('../common/GlassBoxShareModal').then((m) => ({ default: m.GlassBoxShareModal })));
const AccountSettingsModal = lazy(() => import('../common/AccountSettingsModal').then((m) => ({ default: m.AccountSettingsModal })));
const CommentHistoryPanel = lazy(() => import('../reviews/CommentHistoryPanel').then((m) => ({ default: m.CommentHistoryPanel })));
const CapInspector = lazy(() => import('../dashboard/CapInspector').then((m) => ({ default: m.CapInspector })));
const PeopleAdminPanel = lazy(() => import('../admin/PeopleAdminPanel').then((m) => ({ default: m.PeopleAdminPanel })));
const OrgSettingsPanel = lazy(() => import('../admin/OrgSettingsPanel').then((m) => ({ default: m.OrgSettingsPanel })));
const EntityApprovalPanel = lazy(() => import('../universe/EntityApprovalPanel').then((m) => ({ default: m.EntityApprovalPanel })));
const DeploymentGatePanel = lazy(() => import('../audit/DeploymentGatePanel').then((m) => ({ default: m.DeploymentGatePanel })));
const EthicsPanel = lazy(() => import('../audit/EthicsPanel').then((m) => ({ default: m.EthicsPanel })));
const CombinedApprovalPanel = lazy(() => import('../plan/CombinedApprovalPanel').then((m) => ({ default: m.CombinedApprovalPanel })));
const SiraModelEditor = lazy(() => import('../sira/SiraModelEditor').then((m) => ({ default: m.SiraModelEditor })));
const SiraCyclesInspector = lazy(() => import('../sira/SiraCyclesInspector').then((m) => ({ default: m.SiraCyclesInspector })));
const PlanItemsPanel = lazy(() => import('../plan/PlanItemsPanel').then((m) => ({ default: m.PlanItemsPanel })));
const ImportWizardPanel = lazy(() => import('../admin/ImportWizardPanel').then((m) => ({ default: m.ImportWizardPanel })));
const ActivityLogPanel = lazy(() => import('../admin/ActivityLogPanel').then((m) => ({ default: m.ActivityLogPanel })));
const OrgControlPanel = lazy(() => import('../admin/OrgControlPanel').then((m) => ({ default: m.OrgControlPanel })));
const SharedWithMePanel = lazy(() => import('../admin/SharePanel').then((m) => ({ default: m.SharePanel })));
const FindingDrilldown = lazy(() => import('../issues/FindingDrilldown').then((m) => ({ default: m.FindingDrilldown })));
const GlobalSearchPanel = lazy(() => import('../documents/GlobalSearchPanel').then((m) => ({ default: m.GlobalSearchPanel })));
const AdhocReviewPanel = lazy(() => import('../documents/AdhocReviewPanel').then((m) => ({ default: m.AdhocReviewPanel })));
const StandardsView = lazy(() => import('../explain/StandardsView').then((m) => ({ default: m.StandardsView })));
const AssuranceCapabilitiesPanel = lazy(() => import('../assurance/AssuranceCapabilitiesPanel').then((m) => ({ default: m.AssuranceCapabilitiesPanel })));

export const INSPECTOR_TITLES: Record<InspectorType, string> = {
  observation: 'Audit Observation & 5C Analysis',
  comment: 'Review Comment',
  sira: 'SIRA Risk & RCM Matrix',
  audit_file: 'Engagement Audit File',
  workbench: 'Working Paper Audit Workbench',
  glassbox_share: 'GlassBox — External Upload Portal',
  account_settings: 'Settings & Preferences',
  comment_history: 'Review Notes & Discussion',
  cap_inspector: 'Corrective Action Plan (CAP) Details',
  people_admin: 'People & Roles',
  org_settings: 'Organisation Settings',
  entity_approval: 'Entity Approval',
  deployment_gate: 'Deployment Gate',
  ethics: 'Ethics Acknowledgement',
  combined_approval: 'Combined Approval',
  sira_model: 'SIRA Model',
  sira_cycles: 'SIRA Cycles & Emergent Risks',
  plan_items: 'Audit Plan Items',
  import_wizard: 'Import',
  activity_log: 'Activity Log',
  org_control: 'Assurance control plane',
  shared_with_me: 'Shared with you',
  finding: 'Audit Finding',
  global_search: 'Search all documents',
  adhoc_review: 'Build an ad-hoc rule',
  assurance_caps: 'Assurance capabilities',
  standards: 'IIA Standards',
};

/** Record type in a URL (/view/:recordType/:id) to the inspector content it shows. */
export const RECORD_TYPE_TO_INSPECTOR: Record<string, InspectorType> = {
  engagement: 'audit_file',
  workpaper: 'workbench',
  observation: 'observation',
  cap: 'cap_inspector',
  org_settings: 'org_settings',
  import_wizard: 'import_wizard',
  activity_log: 'activity_log',
  finding: 'finding',
};

export interface RecordContentProps {
  type: InspectorType;
  data?: any;
  onClose: () => void;
}

export const RecordContent: React.FC<RecordContentProps> = ({ type, data, onClose }) => (
  <Suspense fallback={<div className="p-6 text-secondary text-apple-13">Loading…</div>}>
    {(() => {
      switch (type) {
        case 'observation':
          return <ObservationDrilldown data={data} />;
        case 'sira':
          return <EntitySiraRcmModal entity={data?.entity} onClose={onClose} />;
        case 'audit_file':
          return <AuditFileModal />;
        case 'workbench':
          return <PaperWorkbenchModal />;
        case 'glassbox_share':
          return <GlassBoxShareModal />;
        case 'account_settings':
          return <AccountSettingsModal onClose={onClose} />;
        case 'comment_history':
          return <CommentHistoryPanel />;
        case 'cap_inspector':
          return <CapInspector />;
        case 'people_admin':
          return <PeopleAdminPanel />;
        case 'org_settings':
          return <OrgSettingsPanel />;
        case 'entity_approval':
          return <EntityApprovalPanel entity={data?.entity} onDone={onClose} />;
        case 'deployment_gate':
          return (
            <DeploymentGatePanel
              result={data?.result ?? null}
              deploy={data?.deploy ?? null}
              onDeployed={data?.onDeployed}
              onResult={data?.onResult}
            />
          );
        case 'ethics':
          return <EthicsPanel members={data?.members} engagementId={data?.engagementId} />;
        case 'combined_approval':
          return <CombinedApprovalPanel request={data?.request ?? null} universeId={data?.universeId} entityId={data?.entityId} onRequested={onClose} />;
        case 'sira_model':
          return <SiraModelEditor model={data?.model ?? null} />;
        case 'sira_cycles':
          return <SiraCyclesInspector universeId={data?.universeId} />;
        case 'plan_items':
          return <PlanItemsPanel items={data?.items ?? []} versions={data?.versions ?? []} />;
        case 'import_wizard':
          return <ImportWizardPanel />;
        case 'activity_log':
          return <ActivityLogPanel />;
        case 'org_control':
          return <OrgControlPanel initialTab={data?.tab} />;
        case 'shared_with_me':
          return <SharedWithMePanel mode="grantee" />;
        case 'finding':
          return <FindingDrilldown findingId={data?.findingId} />;
        case 'global_search':
          return <GlobalSearchPanel />;
        case 'adhoc_review':
          return <AdhocReviewPanel />;
        case 'assurance_caps':
          return <AssuranceCapabilitiesPanel />;
        case 'standards':
          return <StandardsView screenId="OA-19" />;
        default:
          return null;
      }
    })()}
  </Suspense>
);
