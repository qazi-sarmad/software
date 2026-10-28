/**
 * Write-path data module (Phase 1, task 1.4).
 *
 * Every shell mutation that used to change only the in-memory seed gets a real write here. The shell
 * calls these when a Supabase project is configured; with no project (a bare dev checkout) it keeps
 * the in-memory demo behaviour. The one rule: a mutation that matters is an RPC, never a local
 * `setState`. Components never import this module directly — the shell does, through AppContext.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';

/** Seal an engagement from the Audit File review surface (migration 0100). */
export function sealEngagement(engagementId: string): Promise<DataResult> {
  return callRpc('seal_engagement', { p_engagement_id: engagementId });
}

/** Reopen a sealed engagement with a justification (migration 0007). */
export function reopenEngagement(engagementId: string, justification: string): Promise<DataResult> {
  return callRpc('reopen_engagement', { p_engagement_id: engagementId, p_justification: justification });
}

/** Create a draft auditable entity in a universe (migration 0100). Returns the new id. */
export async function addEntity(
  universeId: string, name: string, kind: string | null
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('add_entity', {
    p_universe_id: universeId, p_name: name, p_kind: kind,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: String(data) };
}

/** Tick or untick a test step, persisted (migration 0100). */
export function setTestStepState(workpaperId: string, stepId: string, completed: boolean): Promise<DataResult> {
  return callRpc('set_test_step_state', {
    p_workpaper_id: workpaperId, p_step_id: stepId, p_completed: completed,
  });
}

/** Record a verified population against a workpaper (migration 0100). */
export function submitPopulation(
  workpaperId: string, sha256: string, fileName: string, rowCount: number, totalCents: number
): Promise<DataResult> {
  return callRpc('submit_population', {
    p_workpaper_id: workpaperId, p_sha256: sha256, p_file_name: fileName,
    p_row_count: rowCount, p_total_cents: totalCents,
  });
}

/** Conclude testing on a workpaper (migration 0100). */
export function finalizeTesting(workpaperId: string): Promise<DataResult> {
  return callRpc('finalize_testing', { p_workpaper_id: workpaperId });
}

/** Sign off a workpaper, sealing it (migration 0028). */
export function signOffWorkpaper(workpaperId: string): Promise<DataResult> {
  return callRpc('sign_off_workpaper', { p_workpaper_id: workpaperId });
}

/** Reopen a signed-off workpaper with a justification (migration 0028). */
export function reopenWorkpaper(workpaperId: string, justification: string): Promise<DataResult> {
  return callRpc('reopen_workpaper', { p_workpaper_id: workpaperId, p_justification: justification });
}

/** Raise an observation against an engagement (migration 0030). */
export function createObservation(
  engagementId: string, workpaperId: string | null, title: string,
  sections: Record<string, string>
): Promise<DataResult> {
  return callRpc('create_observation', {
    p_engagement_id: engagementId, p_workpaper_id: workpaperId, p_title: title, p_sections: sections,
  });
}

/** Append a hash-chained ledger entry through the database (migration 0073). */
export function appendLedgerEntryDb(
  orgId: string, action: string, payload: Record<string, unknown>
): Promise<DataResult> {
  return callRpc('append_ledger_entry', { p_org_id: orgId, p_action: action, p_payload: payload });
}
