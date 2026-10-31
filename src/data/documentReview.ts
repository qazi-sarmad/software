/**
 * Document-review data module (S7, OA-36).
 *
 * The screen reads a file's tier-1 extracted text and records the findings it produces. Both go
 * through the database: `document_extraction_text` (0189) returns the caller's own organisation's
 * text or a named refusal, and `systeligon_finding_record` (0118) appends the findings to the ledger
 * so a sealed report can cite them with their rule provenance.
 *
 * Components never import the Supabase client (rule M8); they call these functions.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type { RuleFinding } from '../lib/systeligon/types';

export { listEvidenceFiles, type EvidenceFileRow } from './documents';
export { evidenceSignedUrl } from './evidence';
import { EVIDENCE_BUCKET } from './evidence';

/** The outcome of reading a file's extracted text. `scan` marks a done extraction with no text. */
export interface ExtractionText {
  ok: boolean;
  /** Present only when `ok`. */
  text?: string;
  /** The extraction status, or `none` when no extraction row exists. */
  status?: string;
  pageCount?: number | null;
  filename?: string | null;
  /** True when the extraction completed but holds no text layer — the document is a scan. */
  scan?: boolean;
  /** The named refusal, present only when not `ok`. */
  reason?: string;
}

/**
 * Read a file's extracted text, scoped to the caller's organisation by the RPC. A refusal is returned
 * as data (`ok:false`, `reason`), never thrown: the screen renders the reason in place, and a
 * cross-tenant file id is indistinguishable from a nonexistent one.
 */
export async function loadExtractionText(fileId: string): Promise<ExtractionText> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('document_extraction_text', { p_file_id: fileId });
  if (error) return { ok: false, reason: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    ok: Boolean(d.ok),
    text: (d.text as string | undefined) ?? undefined,
    status: (d.status as string | undefined) ?? undefined,
    pageCount: (d.page_count as number | null | undefined) ?? null,
    filename: (d.filename as string | null | undefined) ?? null,
    scan: d.scan === true,
    reason: (d.reason as string | undefined) ?? undefined,
  };
}

/**
 * Record a document review's findings against an engagement. `evaluatedAt` is the run instant the
 * screen captured (the pure engine never reads a clock); re-recording the same run adds nothing.
 */
export function recordDocumentReviewFindings(
  engagementId: string | null, evaluatedAt: string, findings: RuleFinding[],
): Promise<DataResult> {
  return callRpc('systeligon_finding_record', {
    p_org: null,
    p_engagement_id: engagementId,
    p_evaluated_at: evaluatedAt,
    p_findings: findings,
  });
}

/**
 * Read a file's stored bytes for the local OCR seam (tier 2). The path comes from
 * `evidence_storage_path` (0189), so the org filter is applied by the database; the bytes are then
 * read from the private bucket. Returns null when the caller may not read the file or it has no
 * stored bytes — a scan that is not read is reported as a scan, never as an empty document.
 */
export async function readEvidenceBytes(fileId: string): Promise<Uint8Array | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('evidence_storage_path', { p_file_id: fileId });
  if (error) return null;
  const d = (data ?? {}) as Record<string, unknown>;
  if (!d.ok) return null;
  const dl = await sb.storage.from(EVIDENCE_BUCKET).download(String(d.storage_path));
  if (dl.error || !dl.data) return null;
  return new Uint8Array(await dl.data.arrayBuffer());
}
