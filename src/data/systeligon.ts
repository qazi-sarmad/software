/**
 * Systeligon findings data module (S13, spec §9.4).
 *
 * The authoritative half is `systeligon_finding_record` (0118): it appends one ledger entry per
 * finding (action `rule_finding`), idempotently per run. `src/data/reportGraph.ts` reads those
 * entries back through `loadSysteligonFindings` and cites them in the report graph, so a finding and
 * its write-up cannot disagree. Components never import the Supabase client.
 */
import { callRpc, type DataResult } from './db';
import type { RuleFinding } from '../lib/systeligon/types';

/**
 * Record a rule run's findings against an engagement. `evaluatedAt` is the run's instant (the pure
 * engine never reads a clock), and re-recording the same run adds nothing. Returns the number of
 * findings newly recorded.
 */
export function recordSysteligonFindings(
  engagementId: string | null, evaluatedAt: string, findings: RuleFinding[],
): Promise<DataResult> {
  return callRpc('systeligon_finding_record', {
    p_org: null, // resolved by the RPC from the caller's session
    p_engagement_id: engagementId,
    p_evaluated_at: evaluatedAt,
    p_findings: findings,
  });
}
