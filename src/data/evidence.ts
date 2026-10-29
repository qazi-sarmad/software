/**
 * Evidence file storage data module (S20).
 *
 * The bytes live in the private `evidence` bucket under `<org_id>/<engagement_id>/<file>`, so
 * org-scoped RLS on storage.objects (migration 0111) admits only the owning organisation. The
 * database, not this module, decides: register_evidence_file re-checks the right, the seal and the
 * size before any row is written, and verify_evidence_file re-derives the hash from the bytes that
 * were actually kept.
 *
 * The order is always bytes -> row -> ledger, never the reverse. A component never imports the
 * Supabase client (rule M8).
 */
import { getClient } from './db';
import { sha256Hex } from '../lib/population';

export const EVIDENCE_BUCKET = 'evidence';
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

export interface EvidenceFileRow {
  id: string;
  filename: string;
  storagePath: string | null;
  mimeType: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  stage: string;
  verifyStatus: string | null;
  verifiedAt: string | null;
  createdAt: string | null;
}

export interface EvidenceUploadResult {
  id: string;
  storagePath: string;
  sha256: string;
  byteSize: number;
}

export type EvidenceVerifyStatus = 'verified' | 'mismatch' | 'no_stored_bytes';

/** Whether the project has a storage bucket wired, so the tab can say "session only" honestly. */
export async function evidenceStorageReady(): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('evidence_storage_ready');
  if (error) return false;
  return Boolean(data);
}

function safeSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
}

/**
 * Upload bytes THEN record the row THEN the ledger entry. The caller supplies the engagement and
 * workpaper; the path is built from the caller's own org id, so it can never point outside it.
 */
export async function uploadEvidence(
  orgId: string,
  engagementId: string,
  workpaperId: string,
  file: { name: string; bytes: Uint8Array; mimeType: string },
  stage: string
): Promise<EvidenceUploadResult> {
  const sb = getClient();
  if (!sb) throw new Error('The evidence store is not configured.');
  if (file.bytes.length === 0) throw new Error('The file is empty.');
  if (file.bytes.length > EVIDENCE_MAX_BYTES) {
    throw new Error(`The file is larger than ${Math.round(EVIDENCE_MAX_BYTES / (1024 * 1024))} MB.`);
  }

  const buf = file.bytes.buffer.slice(
    file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength
  ) as ArrayBuffer;
  const sha256 = await sha256Hex(buf);

  const storagePath = `${orgId}/${engagementId}/${Date.now()}-${safeSegment(file.name)}`;
  const up = await sb.storage.from(EVIDENCE_BUCKET).upload(storagePath, file.bytes, {
    contentType: file.mimeType || 'application/octet-stream', upsert: false,
  });
  if (up.error) throw new Error(`The file could not be stored: ${up.error.message}`);

  const { data, error } = await sb.rpc('register_evidence_file', {
    p_engagement_id: engagementId,
    p_workpaper_id: workpaperId,
    p_filename: file.name,
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_mime_type: file.mimeType || 'application/octet-stream',
    p_byte_size: file.bytes.length,
    p_stage: stage,
  });
  if (error) throw new Error(error.message);

  return { id: data as string, storagePath, sha256, byteSize: file.bytes.length };
}

/** The rows the evidence tab shows, with their storage facts. */
export async function listEvidenceFiles(workpaperId: string): Promise<EvidenceFileRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('evidence_files_for', { p_workpaper_id: workpaperId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    filename: r.filename as string,
    storagePath: (r.storage_path as string | null) ?? null,
    mimeType: (r.mime_type as string | null) ?? null,
    byteSize: (r.byte_size as number | null) ?? null,
    contentSha256: (r.content_sha256 as string | null) ?? null,
    stage: (r.stage as string) ?? 'testing',
    verifyStatus: (r.verify_status as string | null) ?? null,
    verifiedAt: (r.verified_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
  }));
}

/**
 * Re-derive the hash from the stored bytes and let the database compare. Returns the status the
 * database recorded: 'verified', 'mismatch' (which also raised an integrity alert) or
 * 'no_stored_bytes' (session-only evidence, which can never be verified).
 */
export async function verifyEvidenceFile(evidenceId: string, storagePath: string): Promise<EvidenceVerifyStatus> {
  const sb = getClient();
  if (!sb) throw new Error('The evidence store is not configured.');
  const dl = await sb.storage.from(EVIDENCE_BUCKET).download(storagePath);
  if (dl.error) throw new Error(`The stored file could not be read: ${dl.error.message}`);
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const observed = await sha256Hex(buf);
  const { data, error } = await sb.rpc('verify_evidence_file', {
    p_evidence_id: evidenceId, p_observed_sha256: observed,
  });
  if (error) throw new Error(error.message);
  return (data as EvidenceVerifyStatus) ?? 'mismatch';
}

/** A short-lived signed URL for viewing the stored bytes. Never a public URL. */
export async function evidenceSignedUrl(storagePath: string, expiresInSeconds = 300): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
