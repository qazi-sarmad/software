/**
 * Global document search data module (S7, OA-39).
 *
 * One box that full-text-searches the caller's organisation's extracted document text and returns
 * only the documents the caller's rights let them see. The search, the org filter and the scope
 * filter all live in the database (`global_document_search`, migration 0190): it applies the same
 * access predicate the `engagements` RLS policy uses, so a document outside the caller's scope — or
 * in another tenant — is simply absent, never a distinguishable refusal.
 *
 * Components never import the Supabase client (rule M8); they call this function.
 */
import { getClient, NOT_CONFIGURED_REASON } from './db';

/** One search hit: the file, where it sits, and the matched snippet. */
export interface GlobalSearchHit {
  fileId: string;
  filename: string;
  stage: string;
  engagementId: string;
  engagementTitle: string;
  entityId: string;
  entityName: string;
  universeId: string;
  universeName: string;
  /** The extracted text with the matched terms wrapped in `<mark>`. */
  headline: string;
  rank: number;
}

/** The outcome of a search. A refusal is returned as data, never thrown. */
export interface GlobalSearchResult {
  ok: boolean;
  /** Present only when `ok`. */
  count?: number;
  hits?: GlobalSearchHit[];
  /** The named refusal, present only when not `ok`. */
  reason?: string;
}

/**
 * Search the caller's organisation's extracted document text. The query is required; a blank one is
 * refused by the database, so the screen shows the reason rather than an unbounded list.
 */
export async function searchDocumentsGlobal(query: string, limit = 25): Promise<GlobalSearchResult> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('global_document_search', { p_query: query, p_limit: limit });
  if (error) return { ok: false, reason: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  if (!d.ok) return { ok: false, reason: (d.reason as string | undefined) ?? 'the search was refused' };
  const rows = Array.isArray(d.results) ? (d.results as Record<string, unknown>[]) : [];
  return {
    ok: true,
    count: (d.count as number | undefined) ?? rows.length,
    hits: rows.map((r) => ({
      fileId: String(r.file_id),
      filename: String(r.filename),
      stage: String(r.stage),
      engagementId: String(r.engagement_id),
      engagementTitle: String(r.engagement_title),
      entityId: String(r.entity_id),
      entityName: String(r.entity_name),
      universeId: String(r.universe_id),
      universeName: String(r.universe_name),
      headline: String(r.headline ?? ''),
      rank: Number(r.rank ?? 0),
    })),
  };
}
