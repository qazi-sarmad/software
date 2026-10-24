/**
 * Conclusion data module (5F, spec §10.1, §15.1).
 *
 * The Testing-sign-off gate, four-eyes and the seal live in the database (migration 0034); this module
 * is the only place the UI reaches them. Components never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';

export interface ConclusionRecord {
  id: string;
  engagementId: string;
  exceptions: unknown[];
  exceptionsPulledAt: string | null;
  overallOpinion: string | null;
  preparedBy: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
  lockedAt: string | null;
}

/** Whether the Testing stage is signed off for an engagement (gates pull_exceptions / sign_conclusion). */
export async function testingSignedOff(engagementId: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('testing_signed_off', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Pull all cross / unverifiable rows into the conclusion's exceptions list. */
export function pullExceptions(engagementId: string): Promise<DataResult> {
  return callRpc('pull_exceptions', { p_engagement_id: engagementId });
}

/** Sign the conclusion (four-eyes) and lock the engagement. */
export function signConclusion(engagementId: string): Promise<DataResult> {
  return callRpc('sign_conclusion', { p_engagement_id: engagementId });
}

export async function getConclusion(engagementId: string): Promise<ConclusionRecord | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from('conclusion_records')
    .select('id, engagement_id, exceptions, exceptions_pulled_at, overall_opinion, prepared_by, signed_off_at, signed_off_by, locked_at')
    .eq('engagement_id', engagementId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id as string,
    engagementId: data.engagement_id as string,
    exceptions: (data.exceptions as unknown[] | null) ?? [],
    exceptionsPulledAt: (data.exceptions_pulled_at as string | null) ?? null,
    overallOpinion: (data.overall_opinion as string | null) ?? null,
    preparedBy: (data.prepared_by as string | null) ?? null,
    signedOffAt: (data.signed_off_at as string | null) ?? null,
    signedOffBy: (data.signed_off_by as string | null) ?? null,
    lockedAt: (data.locked_at as string | null) ?? null,
  };
}
