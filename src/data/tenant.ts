/**
 * Tenant data loader (Phase 1, task 1.1).
 *
 * The one place the application shell reads its own tenant data. Before this module existed the shell
 * rendered from an in-memory seed: in development the flagged demo tenant, in a production build the
 * empty seed, so every screen showed its empty state (docs/FUNCTIONALITY-AUDIT.md §1). This module
 * hydrates the shell from the database through RLS-scoped table reads, which is the same access rule
 * the per-screen data modules already use (`org_id = jwt_org_id()` plus the caller's scope).
 *
 * Reads only. Every write stays behind an RPC, as elsewhere. The loader never decides access: the
 * database does, and a row the caller may not see is simply absent from the result.
 *
 * Every read is independent and failure-tolerant. A table that is missing, denied by RLS or empty
 * yields an empty array rather than failing the whole load, so one gap cannot blank the shell.
 */
import { getClient } from './client';
import type {
  AuditCapItem,
  AuditControl,
  AuditEngagement,
  AuditEntity,
  AuditIssue,
  AuditObservation,
  AuditUniverse,
  CapStatus,
  EngagementStage,
  EntityApprovalStatus,
  LedgerEntry,
  LedgerEventType,
  ReviewComment,
  Role,
  Severity,
  User,
  WorkingPaper,
  WorkpaperStatus,
} from '../types';
import type { AnalyticsSample, TenantSeed } from '../types/seed';
import type { LedgerEntry as _LedgerEntry } from '../types';

/** The tenant snapshot: the same shape the shell already consumes, hydrated from the database. */
export interface TenantSnapshot {
  universes: AuditUniverse[];
  entities: AuditEntity[];
  engagements: AuditEngagement[];
  controls: AuditControl[];
  workpapers: WorkingPaper[];
  observations: AuditObservation[];
  issues: AuditIssue[];
  comments: ReviewComment[];
  capItems: AuditCapItem[];
  ledger: LedgerEntry[];
  analyticsSample: AnalyticsSample;
  documentSample: string;
}

const EMPTY_ANALYTICS: AnalyticsSample = { varianceItems: [], tbItems: [], anomalyItems: [] };

/**
 * Run a scoped select and map its rows. A failure (no client, RLS denial, missing table) returns an
 * empty array and is reported to the caller as a warning, never thrown: the shell must still render.
 */
async function readRows(
  table: string,
  columns: string,
  map: (row: Record<string, unknown>) => unknown,
  warnings: string[]
): Promise<any[]> {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb.from(table).select(columns);
    if (error) {
      warnings.push(`${table}: ${error.message}`);
      return [];
    }
    return (data ?? []).map((r) => map(r as unknown as Record<string, unknown>));
  } catch (err) {
    warnings.push(`${table}: ${err instanceof Error ? err.message : 'read failed'}`);
    return [];
  }
}

function s(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function riskRating(v: unknown): 'low' | 'medium' | 'high' | 'critical' {
  const t = s(v, 'medium').toLowerCase();
  return t === 'low' || t === 'high' || t === 'critical' ? t : 'medium';
}

function approvalStatus(v: unknown): EntityApprovalStatus {
  const t = s(v, 'draft');
  return t === 'pending' || t === 'approved' || t === 'rejected' ? t : 'draft';
}

function severity(v: unknown): Severity {
  const t = s(v, 'medium').toLowerCase();
  return t === 'low' || t === 'high' || t === 'critical' ? t : 'medium';
}

function stage(v: unknown): EngagementStage {
  const t = s(v, 'planning');
  return t === 'testing' || t === 'conclusion' ? t : 'planning';
}

function capStatus(v: unknown): CapStatus {
  const t = s(v, 'Open');
  const known: CapStatus[] = ['Open', 'In progress', 'Pending validation', 'Overdue', 'Closed'];
  return (known as string[]).includes(t) ? (t as CapStatus) : 'Open';
}

function workpaperStatus(v: unknown): WorkpaperStatus {
  const t = s(v, 'not_started');
  const known: WorkpaperStatus[] = ['not_started', 'draft', 'in_progress', 'ready_for_review', 'completed', 'signed_off', 'reopened'];
  return (known as string[]).includes(t) ? (t as WorkpaperStatus) : 'draft';
}

const LEDGER_EVENT_TYPES: readonly string[] = [
  'test_finalize', 'reviewer_sign_off', 'audit_sign_off', 'plan_approval', 'adhoc_approve', 'adhoc_reject',
  'reopen', 'evidence_drop', 'evidence_attach', 'cap_update', 'config_changed', 'population_verified',
];

function ledgerEventType(v: unknown): LedgerEventType {
  const t = s(v, 'config_changed');
  return (LEDGER_EVENT_TYPES.includes(t) ? t : 'config_changed') as LedgerEventType;
}

function mapLedger(r: Record<string, unknown>): LedgerEntry {
  const payload = (r.payload as Record<string, unknown> | null) ?? {};
  return {
    seq: typeof r.seq === 'number' ? r.seq : Number(r.seq ?? 0),
    prevHash: s(r.prev_hash),
    hash: s(r.hash),
    timestamp: s(r.ts),
    actorId: s(r.actor_id),
    actorName: s(payload.actor_name, ''),
    actorRole: s(payload.actor_role, 'observer') as Role,
    eventType: ledgerEventType(r.action),
    entityId: s(payload.entity_id),
    recordId: s(payload.record_id),
    recordType: 'engagement',
    payloadSummary: s(payload.summary, s(r.action)),
    payloadHash: s(r.payload_hash),
  };
}

/**
 * Load the tenant snapshot for the signed-in session. Every read is RLS-scoped, so the caller's org
 * and scope decide what is present. `warnings` collects per-table failures for the caller to surface;
 * it is never used to hide data.
 */
export async function loadTenantSnapshot(warnings: string[] = []): Promise<TenantSnapshot> {
  const universes = (await readRows('universes', 'id, name, domain', (r) => ({
    id: s(r.id), name: s(r.name), code: '', description: s(r.domain),
    totalEntities: 0, highRiskCount: 0, lastReviewDate: '',
  }), warnings)) as AuditUniverse[];

  const entities = (await readRows('entities', 'id, universe_id, name, kind, status, approved, rejection_reason', (r) => ({
    id: s(r.id), universeId: s(r.universe_id), name: s(r.name), code: '',
    department: s(r.kind), headOfDepartment: '',
    inherentRisk: riskRating(null), residualRisk: riskRating(null),
    siraScore: 0, controlsCount: 0, lastAuditDate: '',
    status: s(r.status) === 'approved' ? 'active' : s(r.status) === 'pending' ? 'in_review' : 'active',
    approvalStatus: approvalStatus(r.status),
    rejectionReason: r.rejection_reason == null ? null : s(r.rejection_reason),
  }), warnings)) as AuditEntity[];

  const engagements = (await readRows('engagements', 'id, universe_id, entity_id, title, stage, sealed, ad_hoc, created_at', (r) => ({
    id: s(r.id), universeId: s(r.universe_id), entityId: s(r.entity_id), title: s(r.title),
    stage: stage(r.stage),
    status: r.sealed ? 'signed_off' : 'in_progress',
    leadAuditorId: '', reviewerId: '',
    periodStart: '', periodEnd: '', dueDate: '',
    completionPercent: r.sealed ? 100 : 0,
    isAdHoc: !!r.ad_hoc,
    sealedAt: r.sealed ? s(r.created_at) : undefined,
  }), warnings)) as AuditEngagement[];

  const workpapers = (await readRows('workpapers', 'id, engagement_id, control_id, stage, status, prepared, prepared_by, prepared_at, signed_off_at, signed_off_by', (r) => {
    const eng = engagements.find((e) => e.id === s(r.engagement_id));
    return {
      id: s(r.id), engagementId: s(r.engagement_id), controlId: s(r.control_id),
      entityId: eng?.entityId ?? '', universeId: eng?.universeId,
      refCode: s(r.id).slice(0, 8), title: 'Working paper',
      status: workpaperStatus(r.status),
      preparerId: s(r.prepared_by), reviewerId: '',
      preparedDate: (r.prepared_at as string | null) ?? undefined,
      isLocked: false,
      signedOffAt: (r.signed_off_at as string | null) ?? undefined,
      signedOffBy: (r.signed_off_by as string | null) ?? undefined,
      testSteps: [], populationCount: 0, sampleCount: 0, exceptionsIdentified: 0,
      conclusion: '', evidenceItems: [],
    };
  }, warnings)) as WorkingPaper[];

  // Persisted test-step ticks (migration 0100). Definitions arrive in Phase 4; today the loader only
  // restores the completed flag on whatever steps the workpaper already carries.
  const stepState = (await readRows('workpaper_step_state', 'workpaper_id, step_id, completed', (r) => ({
    workpaperId: s(r.workpaper_id), stepId: s(r.step_id), completed: !!r.completed,
  }), warnings)) as { workpaperId: string; stepId: string; completed: boolean }[];
  for (const wp of workpapers) {
    const own = stepState.filter((st) => st.workpaperId === wp.id);
    if (own.length) wp.testSteps = own.map((st) => ({ id: st.stepId, description: st.stepId, completed: st.completed }));
  }

  const observations = (await readRows('observations', 'id, engagement_id, workpaper_id, title, sections, status, submitted_at, submitted_by', (r) => {
    const eng = engagements.find((e) => e.id === s(r.engagement_id));
    const sections = (r.sections as Record<string, string> | null) ?? {};
    return {
      id: s(r.id), workpaperId: s(r.workpaper_id), entityId: eng?.entityId ?? '',
      universeId: eng?.universeId, title: s(r.title, 'Observation'),
      condition: s(sections.condition), criteria: s(sections.criteria),
      cause: s(sections.cause), consequence: s(sections.effect), recommendation: s(sections.recommendation),
      severity: severity(sections.severity),
      status: s(r.status) === 'submitted' ? 'open' : s(r.status) === 'draft' ? 'draft' : 'open',
      createdAt: s(r.submitted_at), raisedBy: s(r.submitted_by),
    };
  }, warnings)) as AuditObservation[];

  const issues = (await readRows('issues', 'id, entity_id, title, status, severity_level_id, created_at', (r) => {
    const ent = entities.find((e) => e.id === s(r.entity_id));
    return {
      id: s(r.id), entityId: s(r.entity_id), universeId: ent?.universeId ?? '',
      department: ent?.department ?? '', title: s(r.title, 'Issue'),
      description: '', severity: 'medium',
      status: s(r.status) === 'closed' ? 'closed' : 'open',
      ownerId: '', identifiedDate: s(r.created_at), dueDate: '',
    };
  }, warnings)) as AuditIssue[];

  const capItems = (await readRows('caps', 'id, engagement_id, finding_id, issue_id, responsible_dept, due_date, action_description, status, created_at', (r) => {
    const eng = engagements.find((e) => e.id === s(r.engagement_id));
    return {
      id: s(r.id), action: s(r.action_description), title: s(r.action_description, 'Corrective action'),
      owner: s(r.responsible_dept), department: s(r.responsible_dept),
      severity: 'medium', dueDate: s(r.due_date),
      status: capStatus(r.status === 'open' ? 'Open' : r.status === 'unverified' ? 'Pending validation' : r.status === 'overdue_unverified' ? 'Overdue' : 'Closed'),
      identifiedDate: s(r.created_at),
      entityId: eng?.entityId ?? '', engagementId: s(r.engagement_id), universeId: eng?.universeId,
    };
  }, warnings)) as AuditCapItem[];

  // Report comments are report-scoped in the database (report_version_id), while the shell's review
  // dock is workpaper-scoped. The text and resolution state carry over; the workpaper link is left
  // empty rather than invented, so a report comment never masquerades as a workpaper blocker.
  const comments = (await readRows('report_comments', 'id, comment_text, commenter_id, status, created_at, resolved_at', (r) => ({
    id: s(r.id), workpaperId: '', authorId: s(r.commenter_id), authorName: '',
    authorRole: 'reviewer' as Role, text: s(r.comment_text), createdAt: s(r.created_at),
    status: r.resolved_at ? 'cleared' : 'open',
    resolved: !!r.resolved_at,
  }), warnings)) as ReviewComment[];

  const ledger = (await readRows('ledger_entries', 'seq, prev_hash, hash, payload_hash, actor_id, action, payload, ts', mapLedger, warnings)) as LedgerEntry[];

  return {
    universes, entities, engagements, controls: [], workpapers, observations,
    issues, comments, capItems, ledger,
    analyticsSample: EMPTY_ANALYTICS, documentSample: '',
  };
}

/**
 * Assemble a TenantSeed the existing shell can consume. The seed's `buildLedger` returns the ledger
 * already read, so the shell's ledger effect is a no-op and no client-side hash chain is invented.
 */
export function snapshotToSeed(snapshot: TenantSnapshot, user: User): TenantSeed {
  return {
    tenantId: user.orgId ?? 'no-tenant',
    isDemo: false,
    universes: snapshot.universes,
    entities: snapshot.entities,
    engagements: snapshot.engagements,
    controls: snapshot.controls,
    workpapers: snapshot.workpapers,
    observations: snapshot.observations,
    issues: snapshot.issues,
    comments: snapshot.comments,
    capItems: snapshot.capItems,
    glassBoxTokens: [],
    analyticsSample: snapshot.analyticsSample,
    documentSample: snapshot.documentSample,
    buildLedger: async () => snapshot.ledger,
  };
}
