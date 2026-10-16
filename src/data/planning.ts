/**
 * Planning data module (4H, spec §10).
 *
 * The only place the Planning screens talk to the database. Reads use the table select policies;
 * every write goes through the 4B RPCs in migration 0025, so the database decides the right the
 * caller needs. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type PlanningSectionType = 'riskcontrol' | 'scope' | 'resources' | 'other';

export interface PlanningSectionRow {
  id: string;
  sectionType: PlanningSectionType;
  content: Record<string, unknown>;
  preparedBy: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
}

export interface PlanningSuggestion {
  suggestionId: string;
  riskId: string;
  inherentRating: string | number | null;
  suggestedControls: unknown;
  priorFindingCount: number;
  riskBand: string | null;
}

export interface SuggestionDecisionRow {
  suggestionId: string;
  accepted: boolean;
  reason: string | null;
  decidedAt: string;
}

/** SIRA pre-fill suggestions for an engagement. Empty when no SIRA cycle is published. */
export async function populateSuggestions(engagementId: string): Promise<PlanningSuggestion[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('populate_planning_suggestions', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((s) => ({
    suggestionId: s.suggestion_id as string,
    riskId: s.risk_id as string,
    inherentRating: (s.inherent_rating as string | number | null) ?? null,
    suggestedControls: s.suggested_controls ?? null,
    priorFindingCount: (s.prior_finding_count as number) ?? 0,
    riskBand: (s.risk_band as string | null) ?? null,
  }));
}

export function decideSuggestion(
  engagementId: string, suggestionId: string, accepted: boolean, reason?: string
): Promise<DataResult> {
  return callRpc('decide_planning_suggestion', {
    p_engagement_id: engagementId, p_suggestion_id: suggestionId, p_accepted: accepted,
    p_reason: reason ?? null,
  });
}

export function saveSection(
  engagementId: string, sectionType: PlanningSectionType, content: Record<string, unknown>
): Promise<DataResult> {
  return callRpc('save_planning_section', {
    p_engagement_id: engagementId, p_section_type: sectionType, p_content: content,
  });
}

export async function checkReconciliation(engagementId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('check_planning_reconciliation', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return !!data;
}

export function acknowledgeDiscrepancy(engagementId: string, reason: string): Promise<DataResult> {
  return callRpc('acknowledge_planning_discrepancy', { p_engagement_id: engagementId, p_reason: reason });
}

export function signPlanning(engagementId: string): Promise<DataResult> {
  return callRpc('sign_planning', { p_engagement_id: engagementId });
}

export async function isPlanningSignedOff(engagementId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('planning_signed_off', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return !!data;
}

export async function listSections(engagementId: string): Promise<PlanningSectionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('planning_sections')
    .select('id, section_type, content, prepared_by, signed_off_at, signed_off_by')
    .eq('engagement_id', engagementId)
    .order('section_type');
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    id: s.id as string,
    sectionType: s.section_type as PlanningSectionType,
    content: (s.content as Record<string, unknown>) ?? {},
    preparedBy: (s.prepared_by as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    signedOffBy: (s.signed_off_by as string | null) ?? null,
  }));
}

export async function listDecisions(engagementId: string): Promise<SuggestionDecisionRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('planning_suggestion_decisions')
    .select('suggestion_id, accepted, reason, decided_at')
    .eq('engagement_id', engagementId)
    .order('decided_at');
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => ({
    suggestionId: d.suggestion_id as string,
    accepted: !!d.accepted,
    reason: (d.reason as string | null) ?? null,
    decidedAt: d.decided_at as string,
  }));
}
