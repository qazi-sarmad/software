import { GlassBoxToken } from '../types';
import { computeSha256 } from './ledger';

export const DEFAULT_ALLOWED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.png', '.docx'];
export const DEFAULT_MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Generates a cryptographically random 32-byte token and records its SHA-256 hash.
 * Only the SHA-256 hash is stored.
 */
export async function createGlassBoxTokenRecord(params: {
  workpaperId: string;
  entityId: string;
  orgId: string;
  allowedExtensions?: string[];
  maxSizeBytes?: number;
  validityDays?: number;
}): Promise<{ rawToken: string; record: GlassBoxToken }> {
  // Generate 32 cryptographically secure random bytes
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const rawToken = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const tokenHash = await computeSha256(rawToken);
  const now = new Date();
  const validityDays = params.validityDays ?? 7;
  const expires = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);

  const record: GlassBoxToken = {
    tokenHash,
    workpaperId: params.workpaperId,
    entityId: params.entityId,
    orgId: params.orgId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    used: false,
    allowedExtensions: params.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS,
    maxSizeBytes: params.maxSizeBytes || DEFAULT_MAX_SIZE_BYTES,
  };

  return { rawToken, record };
}

export interface GlassBoxValidationResult {
  valid: boolean;
  record?: GlassBoxToken;
  error?: string;
}

/**
 * Validates a raw token against stored token records.
 * Checks:
 * - Token hash matches
 * - Correct organization ID
 * - Not expired (< 7 days)
 * - Not already used (single-use)
 */
export async function validateGlassBoxToken(
  rawToken: string,
  currentOrgId: string,
  tokens: GlassBoxToken[],
  currentTime = new Date()
): Promise<GlassBoxValidationResult> {
  if (!rawToken || rawToken.length < 32) {
    return { valid: false, error: 'Invalid token structure' };
  }

  const tokenHash = await computeSha256(rawToken);
  const record = tokens.find((t) => t.tokenHash === tokenHash);

  if (!record) {
    return { valid: false, error: 'Token not found or does not exist' };
  }

  // Org boundary check
  if (record.orgId !== currentOrgId) {
    return { valid: false, error: 'Token belongs to an unauthorized organization' };
  }

  // Expiration check
  const expiryDate = new Date(record.expiresAt);
  if (currentTime.getTime() > expiryDate.getTime()) {
    return { valid: false, error: 'Evidence upload link has expired (7-day window passed)' };
  }

  // Single-use check
  if (record.used) {
    return { valid: false, error: 'Evidence upload link has already been used' };
  }

  return { valid: true, record };
}

/**
 * Validates an uploaded file against token constraints.
 */
export function validateEvidenceFile(
  filename: string,
  sizeBytes: number,
  tokenRecord: GlassBoxToken
): { allowed: boolean; error?: string } {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  const isAllowedExt = tokenRecord.allowedExtensions.some(
    (allowed) => allowed.toLowerCase() === ext
  );

  if (!isAllowedExt) {
    return {
      allowed: false,
      error: `File extension "${ext}" is not permitted. Allowed: ${tokenRecord.allowedExtensions.join(
        ', '
      )}`,
    };
  }

  if (sizeBytes > tokenRecord.maxSizeBytes) {
    const maxMb = (tokenRecord.maxSizeBytes / (1024 * 1024)).toFixed(0);
    return {
      allowed: false,
      error: `File size exceeds the permitted cap of ${maxMb} MB`,
    };
  }

  return { allowed: true };
}
