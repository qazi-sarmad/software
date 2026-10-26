/**
 * Engagement certificate data module (F11, S8).
 *
 * Every call goes through a typed function here; components never import the database client
 * (rule M8). Issuing, revoking and the two anonymous verification calls are security-definer RPCs in
 * migration 0062; this module reads their results and maps them to the model in src/lib/certificate.ts.
 */
import { callRpc, getClient, type DataResult } from './db';
import type {
  CertificateConfigField,
  CertificateDocument,
  CertificateRow,
  CertificateStatus,
  VerifyResult,
} from '../lib/certificate';

const NOT_CONFIGURED = 'The certificate module is not configured.';

interface RawCertificate {
  id: string;
  engagement_id: string;
  version: number;
  cert_hash: string;
  status: string;
  issued_by: string | null;
  issued_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

interface RawVerify {
  status: string;
  issued_at: string | null;
  cert_hash: string | null;
  sealed_workpapers: number | null;
  findings_count: number | null;
  organisation: string | null;
  engagement_title: string | null;
}

function toRow(raw: RawCertificate): CertificateRow {
  return {
    id: raw.id,
    engagementId: raw.engagement_id,
    version: raw.version,
    certHash: raw.cert_hash,
    status: raw.status as CertificateStatus,
    issuedBy: raw.issued_by,
    issuedAt: raw.issued_at,
    revokedAt: raw.revoked_at,
    revokeReason: raw.revoke_reason,
  };
}

/** The certificates of an organisation, newest first. */
export async function listCertificates(orgId: string): Promise<CertificateRow[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('certificate_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawCertificate[]).map(toRow);
}

/** One certificate with its canonical document, or null when it is not visible to the caller. */
export async function getCertificate(
  certificateId: string
): Promise<{ row: CertificateRow; canonical: CertificateDocument } | null> {
  const sb = getClient();
  if (!sb || !certificateId) return null;
  const { data, error } = await sb.rpc('certificate_get', { p_certificate_id: certificateId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as
    | (RawCertificate & { canonical: CertificateDocument })
    | undefined;
  if (!raw) return null;
  return { row: toRow(raw), canonical: raw.canonical ?? {} };
}

/** Issue a certificate for a sealed engagement. Needs manage_engagements and the certificates feature. */
export function issueCertificate(
  engagementId: string, extra: Record<string, unknown> = {}
): Promise<DataResult> {
  return callRpc('certificate_issue', { p_engagement_id: engagementId, p_extra: extra }, NOT_CONFIGURED);
}

/** Revoke a certificate. Needs can_reopen and a reason of at least five characters. */
export function revokeCertificate(certificateId: string, reason: string): Promise<DataResult> {
  return callRpc('certificate_revoke', { p_certificate_id: certificateId, p_reason: reason }, NOT_CONFIGURED);
}

/** The configurable field list for the certificate, in order. Needs the caller's organisation. */
export async function getCertificateConfig(orgId: string): Promise<CertificateConfigField[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('certificate_config_get', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { field_key: string; label: string; ordinal: number; enabled: boolean }[]).map(
    (f) => ({ fieldKey: f.field_key, label: f.label, ordinal: f.ordinal, enabled: f.enabled })
  );
}

/** Save the field list (order and which fields appear). Needs edit_config. */
export function saveCertificateConfig(
  orgId: string, fields: CertificateConfigField[]
): Promise<DataResult> {
  return callRpc('certificate_config_save', {
    p_org: orgId,
    p_fields: fields.map((f) => ({ field_key: f.fieldKey, enabled: f.enabled })),
  }, NOT_CONFIGURED);
}

/**
 * The anonymous verification call. Needs no session: it is one of exactly two functions callable by
 * role anon (F11). It returns only status, issued_at, the hash and counts.
 */
export async function verifyCertificate(certificateId: string): Promise<VerifyResult | null> {
  const sb = getClient();
  if (!sb || !certificateId) return null;
  const { data, error } = await sb.rpc('verify_certificate', { p_id: certificateId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as RawVerify | undefined;
  if (!raw) return null;
  return {
    status: raw.status as VerifyResult['status'],
    issuedAt: raw.issued_at,
    certHash: raw.cert_hash,
    sealedWorkpapers: raw.sealed_workpapers,
    findingsCount: raw.findings_count,
    organisation: raw.organisation,
    engagementTitle: raw.engagement_title,
  };
}

/** The anonymous Board Pack verification call, the other anon-callable function. */
export async function verifyBoardPack(packId: string): Promise<{
  status: string; issuedAt: string | null; dataHash: string | null; organisation: string | null;
} | null> {
  const sb = getClient();
  if (!sb || !packId) return null;
  const { data, error } = await sb.rpc('verify_board_pack', { p_id: packId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as
    | { status: string; issued_at: string | null; data_hash: string | null; organisation: string | null }
    | undefined;
  if (!raw) return null;
  return {
    status: raw.status,
    issuedAt: raw.issued_at,
    dataHash: raw.data_hash,
    organisation: raw.organisation,
  };
}

export interface ReportRootResult {
  status: string;
  issuedAt: string | null;
  engineVersion: string | null;
  templateVersion: string | null;
  phraseLibraryVersion: string | null;
  modelId: string | null;
  organisation: string | null;
}

/**
 * The anonymous report-root verification call (W10.3). Needs no session: it is the third and last
 * function callable by role anon (F11, D-W-PUBLIC-ROOT). Given a graph root it returns only
 * existence, the issuance time and the engine, template and phrase-library versions. It returns no
 * tenant content.
 */
export async function verifyReportRoot(root: string): Promise<ReportRootResult | null> {
  const sb = getClient();
  if (!sb || !root) return null;
  const { data, error } = await sb.rpc('verify_report_root', { p_root: root });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as
    | {
        status: string; issued_at: string | null; engine_version: string | null;
        template_version: string | null; phrase_library_version: string | null;
        model_id: string | null; organisation: string | null;
      }
    | undefined;
  if (!raw) return null;
  return {
    status: raw.status,
    issuedAt: raw.issued_at,
    engineVersion: raw.engine_version,
    templateVersion: raw.template_version,
    phraseLibraryVersion: raw.phrase_library_version,
    modelId: raw.model_id,
    organisation: raw.organisation,
  };
}
