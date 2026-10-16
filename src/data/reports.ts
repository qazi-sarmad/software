/**
 * Reports data module (6G, spec §15).
 *
 * Drafting, freezing and issuance live in the database (migrations 0036, 0037, 0040); this module is
 * the only place the UI reaches them. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type ReportStatus = 'draft' | 'issued_v1' | 'revised' | 'frozen';
export type CommentStatus = 'open' | 'incorporated' | 'rejected';

export interface ReportVersionRow {
  id: string;
  engagementId: string;
  versionNumber: number;
  status: ReportStatus;
  frozenAt: string | null;
  issuedAt: string | null;
  createdAt: string | null;
}

export interface ReportBlockRow {
  id: string;
  reportVersionId: string;
  sectionType: string;
  blockType: 'text' | 'table' | 'image';
  content: Record<string, unknown>;
  position: number;
  isPlaceholder: boolean;
  editedAt: string | null;
  editedBy: string | null;
}

export interface ReportCommentRow {
  id: string;
  reportVersionId: string;
  blockId: string | null;
  commentText: string;
  commenterId: string | null;
  status: CommentStatus;
  resolutionReason: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ReportSummary {
  findingsBySeverity: Record<string, number>;
  issuesBySeverity: Record<string, number>;
  testsPassed: number;
  testsFailed: number;
}

/** Assemble a report version from the structured records; placeholder blocks mark missing values. */
export function composeReport(engagementId: string): Promise<DataResult> {
  return callRpc('compose_report', { p_engagement_id: engagementId });
}

/** Counts of findings/issues by severity and the proportion of tests passed and failed. */
export async function computeReportSummary(reportVersionId: string): Promise<ReportSummary | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('compute_report_summary', { p_report_version_id: reportVersionId });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    findingsBySeverity: (d.findings_by_severity as Record<string, number> | null) ?? {},
    issuesBySeverity: (d.issues_by_severity as Record<string, number> | null) ?? {},
    testsPassed: (d.tests_passed as number | null) ?? 0,
    testsFailed: (d.tests_failed as number | null) ?? 0,
  };
}

export function freezeReport(reportVersionId: string): Promise<DataResult> {
  return callRpc('freeze_report', { p_report_version_id: reportVersionId });
}

export function issueReport(reportVersionId: string): Promise<DataResult> {
  return callRpc('issue_report', { p_report_version_id: reportVersionId });
}

export function addReportComment(reportVersionId: string, blockId: string | null, text: string): Promise<DataResult> {
  return callRpc('add_report_comment', {
    p_report_version_id: reportVersionId, p_block_id: blockId, p_comment_text: text,
  });
}

export function resolveReportComment(commentId: string, status: 'incorporated' | 'rejected', reason: string): Promise<DataResult> {
  return callRpc('resolve_report_comment', { p_comment_id: commentId, p_status: status, p_reason: reason });
}

export async function openReportCommentCount(reportVersionId: string): Promise<number> {
  const sb = getClient();
  if (!sb) return 0;
  const { data, error } = await sb.rpc('open_report_comment_count', { p_report_version_id: reportVersionId });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

export async function listReportVersions(engagementId: string): Promise<ReportVersionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('report_versions')
    .select('id, engagement_id, version_number, status, frozen_at, issued_at, created_at')
    .eq('engagement_id', engagementId)
    .order('version_number', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({
    id: v.id as string,
    engagementId: v.engagement_id as string,
    versionNumber: (v.version_number as number | null) ?? 1,
    status: (v.status as ReportStatus) ?? 'draft',
    frozenAt: (v.frozen_at as string | null) ?? null,
    issuedAt: (v.issued_at as string | null) ?? null,
    createdAt: (v.created_at as string | null) ?? null,
  }));
}

export async function listReportBlocks(reportVersionId: string): Promise<ReportBlockRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('report_blocks')
    .select('id, report_version_id, section_type, block_type, content, position, is_placeholder, edited_at, edited_by')
    .eq('report_version_id', reportVersionId)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    id: b.id as string,
    reportVersionId: b.report_version_id as string,
    sectionType: b.section_type as string,
    blockType: (b.block_type as ReportBlockRow['blockType']) ?? 'text',
    content: (b.content as Record<string, unknown> | null) ?? {},
    position: (b.position as number | null) ?? 0,
    isPlaceholder: Boolean(b.is_placeholder),
    editedAt: (b.edited_at as string | null) ?? null,
    editedBy: (b.edited_by as string | null) ?? null,
  }));
}

export async function listReportComments(reportVersionId: string): Promise<ReportCommentRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('report_comments')
    .select('id, report_version_id, block_id, comment_text, commenter_id, status, resolution_reason, created_at, resolved_at, resolved_by')
    .eq('report_version_id', reportVersionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    reportVersionId: c.report_version_id as string,
    blockId: (c.block_id as string | null) ?? null,
    commentText: c.comment_text as string,
    commenterId: (c.commenter_id as string | null) ?? null,
    status: (c.status as CommentStatus) ?? 'open',
    resolutionReason: (c.resolution_reason as string | null) ?? null,
    createdAt: (c.created_at as string | null) ?? null,
    resolvedAt: (c.resolved_at as string | null) ?? null,
    resolvedBy: (c.resolved_by as string | null) ?? null,
  }));
}
