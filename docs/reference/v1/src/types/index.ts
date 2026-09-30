export type Role = 'admin' | 'cia' | 'reviewer' | 'preparer' | 'auditee';

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

export type EngagementStage = 'planning' | 'fieldwork' | 'review' | 'reporting' | 'closed';

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
};

export type AuditControl = {
  id: string;
  entityId: string;
  engagementId: string;
  code: string;
  title: string;
  description: string;
  controlType: 'preventive' | 'detective' | 'corrective';
  frequency: 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  ownerId: string;
  effectiveness: ControlEffectiveness;
  sampleSize: number;
  exceptionsCount: number;
};

export type WorkpaperStatus = 'not_started' | 'in_progress' | 'completed' | 'signed_off' | 'reopened';

export type WorkingPaper = {
  id: string;
  engagementId: string;
  controlId: string;
  entityId: string;
  universeId: string;
  refCode: string;
  title: string;
  status: WorkpaperStatus;
  preparerId: string;
  reviewerId: string;
  preparedDate?: string;
  reviewedDate?: string;
  objective: string;
  scope: string;
  methodology: string;
  testSteps: {
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
  sealed: boolean;
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
  controlId: string;
  entityId: string;
  universeId: string;
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
  status: 'identified' | 'management_response' | 'remediated' | 'closed' | 'overdue';
  ownerId: string;
  identifiedDate: string;
  dueDate: string;
  remediatedDate?: string;
  resolutionNotes?: string;
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
  agingDays: number;
  status: CapStatus;
  retestStatus: RetestStatus;
  approvalStatus: CapApprovalStatus;
  originatingReport: string;
  engagementId: string;
  entityId: string;
  universeId: string;
};

export type ReviewComment = {
  id: string;
  workpaperId: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  text: string;
  createdAt: string;
  status: 'open' | 'addressed' | 'cleared';
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
  | 'evidence_drop';

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
  recordType: 'engagement' | 'workpaper' | 'plan' | 'control' | 'observation' | 'evidence';
  payloadSummary: string;
  payloadHash: string;
  justification?: string;
};

export type GlassBoxToken = {
  tokenHash: string; // SHA-256 of 32 random bytes token
  workpaperId: string;
  entityId: string;
  orgId: string;
  createdAt: string;
  expiresAt: string; // 7 days
  used: boolean;
  usedAt?: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
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
