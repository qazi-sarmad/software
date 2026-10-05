export type Role =
  | 'cia'
  | 'audit_manager'
  | 'reviewer'
  | 'preparer'
  | 'observer'
  | 'org_admin'
  | 'auditee';

export type UserScopeAssignment = {
  userId: string;
  universeIds: string[]; // empty or '*' means all universes
  entityIds: string[];   // empty or '*' means all entities within assigned universes
  role: Role;
};

export type User = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: Role;
  universeIds: string[];
  entityIds: string[];
  department?: string;
};

export type AuditUniverse = {
  id: string;
  name: string;
  code: string;
  description: string;
  totalEntities: number;
  highRiskCount: number;
  lastReviewDate: string;
};

export type RiskRating = 'low' | 'medium' | 'high' | 'critical';
export type ControlEffectiveness = 'effective' | 'needs_improvement' | 'ineffective' | 'not_tested';

export type AuditEntity = {
  id: string;
  universeId: string;
  name: string;
  code: string;
  department: string;
  headOfDepartment: string;
  inherentRisk: RiskRating;
  residualRisk: RiskRating;
  siraScore: number; // 0 - 100
  controlsCount: number;
  lastAuditDate: string;
  status: 'active' | 'in_review' | 'dormant';
};

export type EngagementStage = 'planning' | 'testing' | 'conclusion';

export type AuditEngagement = {
  id: string;
  universeId: string;
  entityId: string;
  title: string;
  stage: EngagementStage;
  status: 'draft' | 'in_progress' | 'signed_off' | 'reopened' | 'closed';
  leadAuditorId: string;
  reviewerId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  completionPercent: number;
  signedOffAt?: string;
  signedOffBy?: string;
  signedHash?: string;
  isLocked?: boolean;
  reopenJustification?: string;
  isAdHoc?: boolean;
  approvalStatus?: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  sealedAt?: string;
  sealedBy?: string;
};

export type AuditControl = {
  id: string;
  entityId: string;
  engagementId: string;
  code: string;
  title: string;
  description: string;
  controlType: 'preventive' | 'preventative' | 'detective' | 'corrective';
  frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  ownerId?: string;
  owner?: string;
  effectiveness: ControlEffectiveness;
  sampleSize?: number;
  exceptionsCount?: number;
};

export type WorkpaperStatus =
  | 'not_started'
  | 'draft'
  | 'in_progress'
  | 'ready_for_review'
  | 'completed'
  | 'signed_off'
  | 'reopened';

export type WorkingPaper = {
  id: string;
  engagementId: string;
  controlId: string;
  entityId: string;
  universeId?: string;
  refCode: string;
  title: string;
  status: WorkpaperStatus;
  preparedBy?: string;
  preparerId: string;
  reviewerId: string;
  preparedDate?: string;
  reviewedDate?: string;
  objective?: string;
  scope?: string;
  methodology?: string;
  isLocked?: boolean;
  signedOffAt?: string;
  signedOffBy?: string;
  signedHash?: string;
  reopenJustification?: string;
  reopenedAt?: string;
  reopenedBy?: string;
  testSteps: {
    id: string;
    description: string;
    completed: boolean;
    resultNote?: string;
  }[];
  procedureSteps?: {
    id: string;
    description: string;
    completed: boolean;
    resultNote?: string;
  }[];
  populationCount: number;
  populationSha256?: string;
  sampleCount: number;
  samplingSeed?: string;
  exceptionsIdentified: number;
  conclusion: string;
  conclusionStage1?: string;
  conclusionStage2?: string;
  isTwoStage?: boolean;
  sealed?: boolean;
  sealedHash?: string;
  evidenceItems: {
    id: string;
    name: string;
    uploadedAt: string;
    uploadedBy: string;
    sha256: string;
    sizeBytes: number;
  }[];
};

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type AuditObservation = {
  id: string;
  workpaperId: string;
  controlId?: string;
  entityId: string;
  universeId?: string;
  title: string;
  condition: string;
  criteria: string;
  cause: string;
  consequence: string;
  recommendation: string;
  severity: Severity;
  status: 'draft' | 'open' | 'action_plan_agreed' | 'closed';
  ruleId?: string;
  inputRowRefs?: number[];
  createdAt: string;
  raisedBy: string;
};

export type AuditIssue = {
  id: string;
  observationId?: string;
  entityId: string;
  universeId: string;
  department: string;
  title: string;
  description: string;
  severity: Severity;
  status: 'identified' | 'management_response' | 'remediated' | 'closed' | 'overdue' | 'open' | 'action_plan_agreed';
  ownerId: string;
  identifiedDate: string;
  dueDate: string;
  remediatedDate?: string;
  resolutionNotes?: string;
  isIssued?: boolean;
  issueDate?: string;
};

export type CapStatus = 'Open' | 'In progress' | 'Pending validation' | 'Overdue' | 'Closed';
export type RetestStatus = 'Not tested' | 'Passed' | 'Failed' | 'In retest';
export type CapApprovalStatus = 'Pending review' | 'Approved by CIA';

export type AuditCapItem = {
  id: string;
  action: string;
  title: string;
  owner: string;
  department: string;
  severity: Severity;
  dueDate: string;
  agingDays?: number;
  status: CapStatus;
  retestStatus: RetestStatus;
  approvalStatus?: CapApprovalStatus;
  capApprovalStatus?: CapApprovalStatus;
  originatingReport?: string;
  validationEvidence?: string;
  identifiedDate: string;
  entityId: string;
  engagementId: string;
  universeId?: string;
  /** Append-only log of due-date changes (see lib/cap.ts). */
  dueDateHistory?: ReadonlyArray<import('../lib/cap').CapDueDateHistoryEntry>;
};

export type ReviewComment = {
  id: string;
  workpaperId: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  text: string;
  createdAt: string;
  status?: 'open' | 'addressed' | 'cleared';
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  entityId?: string;
  replies?: {
    id: string;
    authorName: string;
    text: string;
    createdAt: string;
  }[];
};

export type LedgerEventType =
  | 'test_finalize'
  | 'reviewer_sign_off'
  | 'audit_sign_off'
  | 'plan_approval'
  | 'adhoc_approve'
  | 'adhoc_reject'
  | 'reopen'
  | 'evidence_drop'
  | 'evidence_attach'
  | 'cap_update';

export type LedgerEntry = {
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  eventType: LedgerEventType;
  entityId: string;
  recordId: string;
  recordType: 'engagement' | 'workpaper' | 'plan' | 'control' | 'observation' | 'evidence' | 'cap_item';
  payloadSummary: string;
  payloadHash: string;
  justification?: string;
};

export type GlassBoxToken = {
  id?: string;
  token?: string;
  tokenHash?: string;
  workpaperId: string;
  entityId: string;
  orgId?: string;
  createdAt?: string;
  expiresAt: string;
  used?: boolean;
  usedAt?: string;
  requestedDocuments?: string[];
  allowedExtensions?: string[];
  maxSizeBytes?: number;
  status?: 'active' | 'used' | 'revoked';
};

export type AnalyticsRule =
  | 'variance'
  | 'trend'
  | 'anomalies'
  | 'tb_check'
  | 'gl_to_tb'
  | 'fs_ratios';

export type AnalysisResultRow = {
  rowIndex: number;
  account: string;
  category: string;
  currentPeriod: number;
  priorPeriod: number;
  varianceVal: number;
  variancePct: number;
  flagged: boolean;
  flagReason?: string;
  ruleId: AnalyticsRule;
  originalRowRef: number;
};

export type ActionType =
  | 'sign_off'
  | 'approve'
  | 'reopen'
  | 'finalize_test'
  | 'edit_workpaper'
  | 'raise_observation'
  | 'view_ledger'
  | 'create_workpaper'
  | 'run_test'
  | 'raise_finding'
  | 'review_sign_off'
  | 'close_issue'
  | 'audit_sign_off'
  | 'propose_ad_hoc'
  | 'approve_plan'
  | 'issue_report'
  | 'view_audit_content'
  | 'view_executive_summary'
  | 'view_issues'
  | 'view_reports';

export interface ActionGateResult {
  allowed: boolean;
  reason?: string;
}
