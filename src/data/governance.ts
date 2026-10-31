/**
 * Governance settings data module (C3.2-B, spec §10, §12, §14.2, §20, §22, §23).
 *
 * The only place the Org Admin Settings screens talk to the database for the lifecycle settings,
 * finding structure, methodology, workflow, notification rules, export/retention, BI parameters and
 * upload limits. Components never import the Supabase client. Reads use org-scoped RPCs; every write
 * goes through an RPC in migration 0082, which requires edit_config and writes a versioned, logged
 * configuration change.
 */
import { callRpc, getClient, type DataResult } from './db';

const NOT_CONFIGURED = 'The settings module is not configured.';

/** The closed set of finding role tags (§14.2). Every check keys off the tag, never the name. */
export const FINDING_ROLE_TAGS = [
  'context', 'condition', 'effect', 'risk', 'criteria', 'cause', 'recommendation', 'other',
] as const;
export type FindingRoleTag = (typeof FINDING_ROLE_TAGS)[number];

/** The organisation team roles a sign-off stage may name (§4.2). */
export const TEAM_ROLES = ['lead', 'preparer', 'reviewer', 'observer'] as const;

/** Formats the platform accepts for evidence (§20). */
export const PLATFORM_EXTENSIONS = ['xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'pdf'] as const;

export interface LifecycleSettings {
  testingMode: 'one_stage' | 'two_stage';
  signoffRolePlanning: string;
  signoffRoleTesting: string;
  signoffRoleConclusion: string;
  reportOpinionRequired: boolean;
  /** §10.1 hours of overlap before the Testing hard lock applies, 0..336. */
  testingGraceHours: number;
}

export interface WorkflowSettings {
  approvalChain: unknown[];
  slaHours: number;
  escalationRole: string;
  escalationHours: number;
}

export interface ExportRetentionSettings {
  exportSchedule: 'manual' | 'daily' | 'weekly' | 'monthly';
  activityRetentionDays: number;
  populationRetentionMonths: number;
}

export interface UploadLimits {
  maxFileMb: number;
  allowedExtensions: string[];
}

export interface FindingSectionRow {
  id: string;
  roleTag: FindingRoleTag;
  label: string;
  position: number;
  required: boolean;
}

export interface MethodologyScaleRow {
  id: string;
  key: string;
  label: string;
  points: unknown[];
}

export interface FsliMappingRow {
  id: string;
  code: string;
  label: string;
  category: string | null;
}

export interface NotificationRuleRow {
  id: string;
  eventKey: string;
  recipientRoles: string[];
  supervisorCopy: boolean;
  enabled: boolean;
}

export interface BiParameterRow {
  checkKey: string;
  label: string;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  value: number | null;
}

async function rpcJson(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? null) as Record<string, unknown> | null;
}

export async function getLifecycleSettings(): Promise<LifecycleSettings> {
  const r = await rpcJson('lifecycle_settings_get', {});
  return {
    testingMode: (r?.testing_mode as 'one_stage' | 'two_stage') ?? 'two_stage',
    signoffRolePlanning: (r?.signoff_role_planning as string) ?? 'reviewer',
    signoffRoleTesting: (r?.signoff_role_testing as string) ?? 'reviewer',
    signoffRoleConclusion: (r?.signoff_role_conclusion as string) ?? 'reviewer',
    reportOpinionRequired: Boolean(r?.report_opinion_required),
    testingGraceHours: Number(r?.testing_grace_hours ?? 0),
  };
}

export function saveLifecycleSettings(s: LifecycleSettings): Promise<DataResult> {
  return callRpc('admin_save_lifecycle_settings', {
    p_testing_mode: s.testingMode,
    p_signoff_role_planning: s.signoffRolePlanning,
    p_signoff_role_testing: s.signoffRoleTesting,
    p_signoff_role_conclusion: s.signoffRoleConclusion,
    p_report_opinion_required: s.reportOpinionRequired,
    p_testing_grace_hours: s.testingGraceHours,
  }, NOT_CONFIGURED);
}

export async function getWorkflowSettings(): Promise<WorkflowSettings> {
  const r = await rpcJson('workflow_settings_get', {});
  return {
    approvalChain: (r?.approval_chain as unknown[]) ?? [],
    slaHours: (r?.sla_hours as number) ?? 48,
    escalationRole: (r?.escalation_role as string) ?? 'cia',
    escalationHours: (r?.escalation_hours as number) ?? 72,
  };
}

export function saveWorkflowSettings(s: WorkflowSettings): Promise<DataResult> {
  return callRpc('admin_save_workflow_settings', {
    p_approval_chain: s.approvalChain,
    p_sla_hours: s.slaHours,
    p_escalation_role: s.escalationRole,
    p_escalation_hours: s.escalationHours,
  }, NOT_CONFIGURED);
}

export async function getExportRetention(): Promise<ExportRetentionSettings> {
  const r = await rpcJson('export_retention_get', {});
  return {
    exportSchedule: (r?.export_schedule as ExportRetentionSettings['exportSchedule']) ?? 'manual',
    activityRetentionDays: (r?.activity_retention_days as number) ?? 365,
    populationRetentionMonths: (r?.population_retention_months as number) ?? 6,
  };
}

export function saveExportRetention(s: ExportRetentionSettings): Promise<DataResult> {
  return callRpc('admin_save_export_retention', {
    p_export_schedule: s.exportSchedule,
    p_activity_retention_days: s.activityRetentionDays,
    p_population_retention_months: s.populationRetentionMonths,
  }, NOT_CONFIGURED);
}

export async function getUploadLimits(): Promise<UploadLimits> {
  const r = await rpcJson('upload_limits_get', {});
  return {
    maxFileMb: (r?.max_file_mb as number) ?? 10,
    allowedExtensions: (r?.allowed_extensions as string[]) ?? [...PLATFORM_EXTENSIONS],
  };
}

export function saveUploadLimits(maxFileMb: number, allowedExtensions: string[]): Promise<DataResult> {
  return callRpc('admin_save_upload_limits', {
    p_max_file_mb: maxFileMb,
    p_allowed_extensions: allowedExtensions,
  }, NOT_CONFIGURED);
}

export async function listFindingSections(): Promise<FindingSectionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('finding_sections')
    .select('id, role_tag, label, position, required')
    .order('position');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    roleTag: r.role_tag as FindingRoleTag,
    label: r.label as string,
    position: r.position as number,
    required: Boolean(r.required),
  }));
}

export function upsertFindingSection(
  roleTag: string, label: string, position: number, required: boolean, id: string | null = null
): Promise<DataResult> {
  return callRpc('admin_upsert_finding_section', {
    p_role_tag: roleTag, p_label: label, p_position: position, p_required: required, p_id: id,
  }, NOT_CONFIGURED);
}

export function deleteFindingSection(id: string): Promise<DataResult> {
  return callRpc('admin_delete_finding_section', { p_id: id }, NOT_CONFIGURED);
}

export async function listMethodologyScales(): Promise<MethodologyScaleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('methodology_scales').select('id, key, label, points').order('key');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    key: r.key as string,
    label: r.label as string,
    points: (r.points as unknown[]) ?? [],
  }));
}

export function upsertMethodologyScale(key: string, label: string, points: unknown[]): Promise<DataResult> {
  return callRpc('admin_upsert_methodology_scale', { p_key: key, p_label: label, p_points: points }, NOT_CONFIGURED);
}

export async function listFsliMappings(): Promise<FsliMappingRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('fsli_mappings').select('id, code, label, category').order('code');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    label: r.label as string,
    category: (r.category as string | null) ?? null,
  }));
}

export function upsertFsliMapping(
  code: string, label: string, category: string | null, id: string | null = null
): Promise<DataResult> {
  return callRpc('admin_upsert_fsli_mapping', {
    p_code: code, p_label: label, p_category: category, p_id: id,
  }, NOT_CONFIGURED);
}

export async function listNotificationRules(): Promise<NotificationRuleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('notification_rules')
    .select('id, event_key, recipient_roles, supervisor_copy, enabled')
    .order('event_key');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    eventKey: r.event_key as string,
    recipientRoles: (r.recipient_roles as string[]) ?? [],
    supervisorCopy: Boolean(r.supervisor_copy),
    enabled: Boolean(r.enabled),
  }));
}

export function upsertNotificationRule(
  eventKey: string, recipientRoles: string[], supervisorCopy: boolean, enabled: boolean,
  id: string | null = null
): Promise<DataResult> {
  return callRpc('admin_upsert_notification_rule', {
    p_event_key: eventKey, p_recipient_roles: recipientRoles,
    p_supervisor_copy: supervisorCopy, p_enabled: enabled, p_id: id,
  }, NOT_CONFIGURED);
}

/** The platform-fixed range and the organisation's value for every §12 check. */
export async function listBiParameters(): Promise<BiParameterRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const [ranges, values] = await Promise.all([
    sb.from('bi_check_ranges').select('check_key, label, min_value, max_value, default_value').order('check_key'),
    sb.from('bi_parameters').select('check_key, value'),
  ]);
  if (ranges.error) throw new Error(ranges.error.message);
  if (values.error) throw new Error(values.error.message);
  const saved = new Map((values.data ?? []).map((v) => [v.check_key as string, v.value as number]));
  return (ranges.data ?? []).map((r) => ({
    checkKey: r.check_key as string,
    label: (r.label as string) ?? (r.check_key as string),
    minValue: Number(r.min_value),
    maxValue: Number(r.max_value),
    defaultValue: Number(r.default_value),
    value: saved.has(r.check_key as string) ? (saved.get(r.check_key as string) as number) : null,
  }));
}

export function setBiParameter(checkKey: string, value: number): Promise<DataResult> {
  return callRpc('admin_set_bi_parameter', { p_check_key: checkKey, p_value: value }, NOT_CONFIGURED);
}

/** The report section ids the report editor can render (§15.2). A template may only name these. */
export const REPORT_SECTION_IDS = ['executive_summary', 'scope', 'findings', 'opinion', 'appendices'] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];

export interface ReportTemplateSection {
  id: ReportSectionId;
  order: number;
}

export interface ReportTemplateRow {
  id: string;
  modelId: string;
  version: number;
  title: string;
  sections: ReportTemplateSection[];
  updatedAt: string | null;
}

/** The organisation's current report template per model (§15.2). */
export async function listReportTemplates(): Promise<ReportTemplateRow[]> {
  const r = await rpcJson('report_template_list', {});
  if (!Array.isArray(r)) return [];
  return (r as Record<string, unknown>[]).map((t) => ({
    id: t.id as string,
    modelId: (t.model_id as string) ?? '',
    version: Number(t.version ?? 1),
    title: (t.title as string) ?? '',
    sections: ((t.sections as { id: string; order: number }[]) ?? []).map((s) => ({
      id: s.id as ReportSectionId, order: Number(s.order ?? 0),
    })),
    updatedAt: (t.updated_at as string) ?? null,
  }));
}

/** Save a new version of the organisation's report template for a model (§15.2, §23). */
export function saveReportTemplate(
  modelId: string, title: string, sections: ReportSectionId[]
): Promise<DataResult> {
  return callRpc('report_template_save', {
    p_model_id: modelId,
    p_title: title,
    p_sections: sections.map((id) => ({ id })),
  }, NOT_CONFIGURED);
}
