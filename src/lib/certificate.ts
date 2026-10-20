/**
 * Engagement certificate model (F11, S8).
 *
 * Pure functions only: no database client, no DOM. The certificate document is built and hashed IN
 * THE DATABASE (0062); this module mirrors that canonical form so the public verification page can
 * compare a dropped certificate JSON or PDF against the hash the database recorded, in the browser,
 * with nothing leaving the tenant boundary. Deterministic throughout (L1): no randomness, no AI.
 */

export type CertificateStatus = 'valid' | 'superseded' | 'revoked';

export interface CertificateRow {
  id: string;
  engagementId: string;
  version: number;
  certHash: string;
  status: CertificateStatus;
  issuedBy: string | null;
  issuedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface CertificateDocument {
  engagement_id?: string;
  engagement_title?: string;
  organisation_id?: string;
  engagement_root_hash?: string;
  version?: number;
  issued_at?: string;
  sealed_workpapers?: number;
  findings_count?: number;
  sealing_actors?: unknown;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CertificateConfigField {
  fieldKey: string;
  label: string;
  ordinal: number;
  enabled: boolean;
}

export interface VerifyResult {
  status: CertificateStatus | 'not_found' | 'rate_limited';
  issuedAt: string | null;
  certHash: string | null;
  sealedWorkpapers: number | null;
  findingsCount: number | null;
  organisation: string | null;
  engagementTitle: string | null;
}

/** The human wording for each status, so a screen never shows a raw key. */
const STATUS_LABELS: Record<string, string> = {
  valid: 'Valid',
  superseded: 'Superseded',
  revoked: 'Revoked',
  not_found: 'Not found',
  rate_limited: 'Too many attempts — try again in a minute',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** True only for the one status that still asserts the engagement is intact. */
export function isVerifiable(status: string): boolean {
  return status === 'valid';
}

/**
 * The canonical text of a JSON value, mirroring `public.canonical_value` (0006): object keys sorted
 * by C collation, no whitespace, arrays in order, strings JSON-escaped, numbers and booleans as
 * written, null as `null`. The database hashes this exact text, so the browser must reproduce it to
 * compare a dropped document against `cert_hash`.
 */
export function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v)}`).join(',')}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return 'null';
}

/** The canonical text of a certificate document. */
export function canonicalDocument(doc: CertificateDocument | null | undefined): string {
  return canonicalValue(doc ?? {});
}

/**
 * SHA-256 (hex) of a text, using WebCrypto only. Throws when no real digest is available: the hash
 * comparison must never fall back to a weak or fake digest (L1, L5).
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw new Error('A secure hash is not available in this browser.');
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hash of a certificate document, computed the way the database computes `cert_hash`. */
export function certificateHash(doc: CertificateDocument): Promise<string> {
  return sha256Hex(canonicalDocument(doc));
}

/** Compare a dropped document against the hash the database recorded. */
export async function matchesHash(
  doc: CertificateDocument, expected: string
): Promise<{ matches: boolean; computed: string }> {
  const computed = await certificateHash(doc);
  return { matches: computed.toLowerCase() === expected.toLowerCase(), computed };
}

/**
 * Extract the certificate document from dropped text. Accepts a bare JSON document or a PDF whose
 * visible text contains the JSON. Returns null when nothing parseable is found, so the caller can
 * show a plain "we could not read a certificate from that file".
 */
export function parseDroppedDocument(text: string): CertificateDocument | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as CertificateDocument;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** The fields that appear on a certificate, in the configured order, enabled ones only. */
export function enabledFields(fields: CertificateConfigField[]): CertificateConfigField[] {
  return [...fields].filter((f) => f.enabled).sort((a, b) => a.ordinal - b.ordinal);
}

/** The verification URL a certificate QR encodes (F11). */
export function certificateVerifyUrl(appBaseUrl: string, certificateId: string): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  return `${base}/verify/${certificateId}`;
}
