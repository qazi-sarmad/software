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
  /**
   * The rights this session holds, from `roles.rights` for the member's role. When absent the
   * app falls back to the default rights for `role` (src/lib/rights.ts). All permission decisions
   * read this, never the role name.
   */
  rights?: Record<string, boolean>;
  universeIds: string[];
  entityIds: string[];
  department?: string;
  /**
   * The id of the organisation this session belongs to, from `org_members.org_id`. Set for a real
   * session (src/data/client.ts); absent for the external token holder. Used only as a display /
   * RPC argument: the database still decides the caller's org from the JWT, never from this value.
   */
  orgId?: string;
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

export type EntityApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

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
  /** Derived display state for the heatmap. Not the approval state. */
  status: 'active' | 'in_review' | 'dormant';
  /** The database approval status (entities.status). Carried so a screen reads entities from one source. */
  approvalStatus: EntityApprovalStatus;
  rejectionReason: string | null;
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
  populationFileName?: string;
  populationTotalCents?: number;
  populationVerifiedAt?: string;
  populationVerifiedBy?: string;
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
export type CapApprovalStatus = 'Pending review' | 'Approved by CIA';

export type CapStatusHistoryEntry = {
  id: string;
  at: string; // org-local or ISO timestamp
  actorUserId: string;
  actorName: string;
  actorRole: Role;
  designationLabel?: string;
  fromStatus: CapStatus;
  toStatus: CapStatus;
  action: string;
  note?: string;
  evidenceRefs?: string[];
};

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
  approvalStatus?: CapApprovalStatus;
  capApprovalStatus?: CapApprovalStatus;
  originatingReport?: string;
  validationEvidence?: string;
  identifiedDate: string;
  entityId: string;
  engagementId: string;
  universeId?: string;
  /** User id of last successful submit-for-validation (four-eyes). */
  lastSubmittedByUserId?: string;
  statusHistory?: CapStatusHistoryEntry[];
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
  | 'cap_update'
  | 'config_changed'
  | 'population_verified';

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
  recordType: 'engagement' | 'workpaper' | 'plan' | 'control' | 'observation' | 'evidence' | 'cap_item' | 'entity' | 'population' | 'universe';
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
  | 'view_reports'
  | 'cap_mark_in_progress'
  | 'cap_submit_validation'
  | 'cap_verify_close'
  | 'cap_reject'
  | 'cap_change_due_date';

/** Stable product capabilities (catalog is fixed; org assigns them to designations). */
export type CapCapability =
  | 'cap_mark_in_progress'
  | 'cap_submit_validation'
  | 'cap_verify_close'
  | 'cap_reject'
  | 'cap_change_due_date';

export type OrgDesignation = {
  id: string;
  label: string;
  capabilities: CapCapability[];
};

/** Serializable org access config (future config-as-ledger). */
export type OrgRoleConfig = {
  orgId: string;
  designations: OrgDesignation[];
  /** userId → designation ids */
  userDesignationIds?: Record<string, string[]>;
  policy?: {
    capJustificationMinChars?: number;
    capRequireEvidenceOnSubmit?: boolean;
  };
};

export interface ActionGateResult {
  allowed: boolean;
  reason?: string;
}
