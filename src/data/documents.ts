/**
 * Document viewer data module (5F, spec §17.2).
 *
 * Full-text search and the stage filter live in the database (migration 0035, `search_documents`); the
 * extraction request is a stub (NOT-DONE §document-extraction). Components never import the client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type DocumentStage = 'planning' | 'testing' | 'conclusion';
export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'unsupported' | 'legacy_not_extracted';

export interface DocumentHit {
  fileId: string;
  extractionId: string | null;
  filename: string | null;
  pageCount: number | null;
  status: ExtractionStatus;
  snippet: string | null;
}

export interface EvidenceFileRow {
  id: string;
  engagementId: string | null;
  filename: string | null;
  stage: DocumentStage | null;
  createdAt: string | null;
}

export function isDocumentStage(value: string | null | undefined): value is DocumentStage {
  return value === 'planning' || value === 'testing' || value === 'conclusion';
}

/**
 * Full-text search scoped to the caller's org and filtered by stage (Planning sees planning documents;
 * Testing adds testing; Conclusion adds all).
 */
export async function searchDocuments(
  engagementId: string, query: string, stage: DocumentStage = 'conclusion'
): Promise<DocumentHit[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('search_documents', {
    p_engagement_id: engagementId, p_query: query, p_stage: stage,
  });
  if (error) throw new Error(error.message);
  const rows = (data as unknown[] | null) ?? [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      fileId: row.file_id as string,
      extractionId: (row.extraction_id as string | null) ?? null,
      filename: (row.filename as string | null) ?? null,
      pageCount: (row.page_count as number | null) ?? null,
      status: (row.status as ExtractionStatus) ?? 'pending',
      snippet: (row.headline as string | null) ?? null,
    };
  });
}

/** Ask the extraction stub to queue an evidence file (writes a pending row; extraction is out of scope). */
export function requestExtraction(fileId: string): Promise<DataResult> {
  return callRpc('request_extraction', { p_file_id: fileId });
}

/**
 * Run real extraction (C2.6, spec §13.1, §20) through the doc-extract Edge Function. The database is
 * the authority: the function re-checks the caller's right and org before it reads a byte. Returns
 * the outcome only — never the file's bytes, and never a secret.
 */
export interface ExtractionOutcome {
  status: 'done' | 'failed' | 'unsupported' | 'legacy_not_extracted';
  extractor: string | null;
  pageCount: number | null;
  characters: number;
  reason: string | null;
}

export async function extractDocument(fileId: string): Promise<ExtractionOutcome> {
  const sb = getClient();
  if (!sb) throw new Error('no database client');
  // Queue first so the row exists, then run the real extraction; both are idempotent.
  const queued = await sb.rpc('request_extraction', { p_file_id: fileId });
  if (queued.error) throw new Error(queued.error.message);
  const { data, error } = await sb.functions.invoke('doc-extract', { body: { fileId } });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    status: (row.status as ExtractionOutcome['status']) ?? 'failed',
    extractor: (row.extractor as string | null) ?? null,
    pageCount: (row.pageCount as number | null) ?? null,
    characters: (row.characters as number | null) ?? 0,
    reason: (row.reason as string | null) ?? null,
  };
}

export async function listEvidenceFiles(engagementId: string): Promise<EvidenceFileRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('evidence_files')
    .select('id, engagement_id, filename, stage, created_at')
    .eq('engagement_id', engagementId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({
    id: f.id as string,
    engagementId: (f.engagement_id as string | null) ?? null,
    filename: (f.filename as string | null) ?? null,
    stage: (f.stage as DocumentStage | null) ?? null,
    createdAt: (f.created_at as string | null) ?? null,
  }));
}
