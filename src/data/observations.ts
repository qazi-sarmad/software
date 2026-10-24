/**
 * Observations / findings / issues data module (5F, spec §14).
 *
 * The readability gate and the promotion rules live in the database (migration 0030); this module is
 * the only place the UI reaches them. Reads use the RLS-scoped tables; writes go through the RPCs so
 * the database decides the caller's org from the JWT and checks the caller's rights. Components never
 * import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type ObservationStatus = 'draft' | 'submitted' | 'finding' | 'issue';

export interface ObservationRow {
  id: string;
  engagementId: string;
  workpaperId: string | null;
  title: string;
  sections: Record<string, string>;
  status: ObservationStatus;
  submittedAt: string | null;
  submittedBy: string | null;
}

export interface SeverityLevelRow {
  id: string;
  name: string;
  colorToken: string;
  rank: number;
}

export interface FindingRow {
  id: string;
  entityId: string | null;
  severity: string | null;
  severityLevelId: string | null;
  linkedControlIds: string[];
  linkedEntityIds: string[];
}

/** One concluded finding, read for the drill-down from a Patterns cluster or heat-map cell (F15). */
export interface FindingDetailRow {
  id: string;
  entityId: string | null;
  entityName: string | null;
  severity: string | null;
  title: string;
  condition: string;
  risk: string;
  effect: string;
  recommendation: string;
}

export interface IssueRow {
  id: string;
  title: string;
  status: string;
  severityLevelId: string | null;
  linkedFindingIds: string[];
}

/** The four mandatory readability tags (spec §14.3). */
export const MANDATORY_SECTIONS = ['context', 'condition', 'effect', 'risk'] as const;

export function createObservation(
  engagementId: string, workpaperId: string | null, title: string, sections: Record<string, string>
): Promise<DataResult> {
  return callRpc('create_observation', {
    p_engagement_id: engagementId, p_workpaper_id: workpaperId, p_title: title, p_sections: sections,
  });
}

export function promoteToFinding(observationId: string, severityLevelId: string | null = null): Promise<DataResult> {
  return callRpc('promote_to_finding', { p_observation_id: observationId, p_severity_level_id: severityLevelId });
}

export function linkFinding(
  findingId: string,
  controlIds: string[] | null = null,
  sampleExceptionIds: string[] | null = null,
  entityIds: string[] | null = null
): Promise<DataResult> {
  return callRpc('link_finding', {
    p_finding_id: findingId, p_control_ids: controlIds,
    p_sample_exception_ids: sampleExceptionIds, p_entity_ids: entityIds,
  });
}

export function createIssue(
  title: string, severityLevelId: string | null = null, findingIds: string[] | null = null
): Promise<DataResult> {
  return callRpc('create_issue', { p_title: title, p_severity_level_id: severityLevelId, p_finding_ids: findingIds });
}

/** The tags missing from an observation, or an empty array when it is ready to promote. */
export async function missingReadabilitySections(observationId: string): Promise<string[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('missing_readability_sections', { p_observation_id: observationId });
  if (error) throw new Error(error.message);
  return (data as string[] | null) ?? [];
}

export async function listObservations(engagementId: string): Promise<ObservationRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('observations')
    .select('id, engagement_id, workpaper_id, title, sections, status, submitted_at, submitted_by')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((o) => ({
    id: o.id as string,
    engagementId: o.engagement_id as string,
    workpaperId: (o.workpaper_id as string | null) ?? null,
    title: (o.title as string | null) ?? 'Observation',
    sections: (o.sections as Record<string, string> | null) ?? {},
    status: (o.status as ObservationStatus) ?? 'draft',
    submittedAt: (o.submitted_at as string | null) ?? null,
    submittedBy: (o.submitted_by as string | null) ?? null,
  }));
}

export async function listSeverityLevels(): Promise<SeverityLevelRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('severity_levels')
    .select('id, name, color_token, rank')
    .order('rank', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    colorToken: s.color_token as string,
    rank: (s.rank as number | null) ?? 0,
  }));
}

export async function listIssues(): Promise<IssueRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('issues')
    .select('id, title, status, severity_level_id, linked_finding_ids')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({
    id: i.id as string,
    title: i.title as string,
    status: (i.status as string | null) ?? 'open',
    severityLevelId: (i.severity_level_id as string | null) ?? null,
    linkedFindingIds: (i.linked_finding_ids as string[] | null) ?? [],
  }));
}

/**
 * One concluded finding, for the drill-down from a Patterns cluster, node or heat-map cell (F15).
 * The read goes through the RLS-scoped `findings` table, so a caller outside the finding's org or
 * scope sees nothing and the surface reports it as unavailable rather than guessing.
 */
export async function getFindingDetail(findingId: string): Promise<FindingDetailRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('findings')
    .select('id, entity_id, severity, sections, entities(name)')
    .eq('id', findingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const sections = (data.sections as Record<string, string> | null) ?? {};
  return {
    id: data.id as string,
    entityId: (data.entity_id as string | null) ?? null,
    entityName: (data.entities as { name?: string } | null)?.name ?? null,
    severity: (data.severity as string | null) ?? null,
    title: sections.title ?? 'Untitled finding',
    condition: sections.condition ?? '',
    risk: sections.risk ?? '',
    effect: sections.effect ?? '',
    recommendation: sections.recommendation ?? '',
  };
}

