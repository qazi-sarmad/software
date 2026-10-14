import { LedgerEntry, LedgerEventType, Role } from '../types';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Thrown when a SHA-256 cannot be computed with a real cryptographic primitive.
 * Callers that seal, sign off or append to the ledger must surface this to the user and abort:
 * there is deliberately no weaker fallback hash (Law 5).
 */
export class HashUnavailableError extends Error {
  readonly code = 'HASH_UNAVAILABLE' as const;
  constructor() {
    super('Secure hashing is unavailable in this environment (crypto.subtle is missing). Nothing was sealed or recorded.');
    this.name = 'HashUnavailableError';
  }
}

/** True only when the platform provides crypto.subtle.digest. */
export function isSecureHashAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto && !!crypto.subtle && typeof crypto.subtle.digest === 'function';
}

/**
 * Computes the SHA-256 hex string of a text. Uses crypto.subtle only.
 * Throws HashUnavailableError if it is not available; never degrades to a non-cryptographic hash.
 */
export async function computeSha256(data: string): Promise<string> {
  if (!isSecureHashAvailable()) {
    throw new HashUnavailableError();
  }
  const dataBuffer = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes payload hash for any structured data.
 */
export async function computePayloadHash(payload: unknown): Promise<string> {
  const jsonString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return computeSha256(jsonString);
}

/**
 * Computes block hash for an entry in the hash chain.
 */
export async function computeEntryHash(
  prevHash: string,
  timestamp: string,
  actorId: string,
  actorRole: string,
  eventType: string,
  entityId: string,
  recordId: string,
  payloadHash: string,
  justification?: string
): Promise<string> {
  const rawData = [
    prevHash,
    timestamp,
    actorId,
    actorRole,
    eventType,
    entityId,
    recordId,
    payloadHash,
    justification || '',
  ].join('|');
  return computeSha256(rawData);
}

/**
 * Creates and appends a new ledger entry in the hash chain.
 */
export async function appendLedgerEntry(
  existingChain: LedgerEntry[],
  params: {
    actorId: string;
    actorName: string;
    actorRole: Role;
    eventType: LedgerEventType;
    entityId: string;
    recordId: string;
    recordType: LedgerEntry['recordType'];
    payloadSummary: string;
    payloadData?: unknown;
    payloadHash?: string;
    justification?: string;
    timestamp?: string;
  }
): Promise<LedgerEntry> {
  if (params.eventType === 'reopen') {
    if (!params.justification || params.justification.trim().length < 10) {
      throw new Error('Reopen event requires a justification note of at least 10 characters');
    }
  }

  const prevHash =
    existingChain.length > 0 ? existingChain[existingChain.length - 1].hash : GENESIS_PREV_HASH;
  const seq = existingChain.length + 1;
  const timestamp = params.timestamp || new Date().toISOString();

  const payloadHash =
    params.payloadHash ||
    (params.payloadData ? await computePayloadHash(params.payloadData) : await computeSha256(params.payloadSummary));

  const hash = await computeEntryHash(
    prevHash,
    timestamp,
    params.actorId,
    params.actorRole,
    params.eventType,
    params.entityId,
    params.recordId,
    payloadHash,
    params.justification
  );

  return {
    seq,
    prevHash,
    hash,
    timestamp,
    actorId: params.actorId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    eventType: params.eventType,
    entityId: params.entityId,
    recordId: params.recordId,
    recordType: params.recordType,
    payloadSummary: params.payloadSummary,
    payloadHash,
    justification: params.justification,
  };
}

export interface VerificationResult {
  valid: boolean;
  brokenSeq?: number;
  error?: string;
}

/**
 * Client-side verification of chain integrity.
 */
export async function verifyChain(entries: LedgerEntry[]): Promise<VerificationResult> {
  if (!entries || entries.length === 0) {
    return { valid: true };
  }

  let expectedPrevHash = GENESIS_PREV_HASH;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.seq !== i + 1) {
      return {
        valid: false,
        brokenSeq: entry.seq,
        error: `Sequence numbering broken at index ${i}, expected seq ${i + 1}, found ${entry.seq}`,
      };
    }

    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        brokenSeq: entry.seq,
        error: `Previous hash mismatch at sequence ${entry.seq}`,
      };
    }

    let calculatedHash: string;
    try {
      calculatedHash = await computeEntryHash(
        entry.prevHash,
        entry.timestamp,
        entry.actorId,
        entry.actorRole,
        entry.eventType,
        entry.entityId,
        entry.recordId,
        entry.payloadHash,
        entry.justification
      );
    } catch (err) {
      if (err instanceof HashUnavailableError) {
        // Never report a chain as valid when it could not actually be checked.
        return { valid: false, error: err.message };
      }
      throw err;
    }

    if (calculatedHash !== entry.hash) {
      return {
        valid: false,
        brokenSeq: entry.seq,
        error: `Cryptographic hash recalculation mismatch at sequence ${entry.seq}`,
      };
    }

    expectedPrevHash = entry.hash;
  }

  return { valid: true };
}

/**
 * Checks if current state matches the signed hash.
 */
export function matchesSignedState(currentHash: string, signedHash?: string): boolean {
  if (!signedHash) return false;
  return currentHash === signedHash;
}
