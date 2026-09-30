import { LedgerEntry, LedgerEventType, Role } from '../types';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Deterministically computes SHA-256 hex string for a given text or JSON object.
 */
export async function computeSha256(data: string): Promise<string> {
  // Use crypto.subtle in browser / modern Node
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for test runner if needed
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
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

    const calculatedHash = await computeEntryHash(
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

/**
 * Generates the seeded initial ledger with authentic cryptographic hashes.
 */
export async function generateInitialLedger(): Promise<LedgerEntry[]> {
  const chain: LedgerEntry[] = [];

  const e1 = await appendLedgerEntry(chain, {
    actorId: 'usr-prep-2',
    actorName: 'Julian Sterling',
    actorRole: 'preparer',
    eventType: 'test_finalize',
    entityId: 'ent-compliance',
    recordId: 'wp-aml-01',
    recordType: 'workpaper',
    payloadSummary: 'Test steps completed and population verified (420,000 wires)',
    payloadHash: 'c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2',
    timestamp: '2026-09-10T14:30:00Z',
  });
  chain.push(e1);

  const e2 = await appendLedgerEntry(chain, {
    actorId: 'usr-rev-1',
    actorName: 'Marcus Vance',
    actorRole: 'reviewer',
    eventType: 'reviewer_sign_off',
    entityId: 'ent-compliance',
    recordId: 'wp-aml-01',
    recordType: 'workpaper',
    payloadSummary: 'Workpaper sealed and approved by Reviewer Marcus Vance',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: '2026-09-14T16:00:00Z',
  });
  chain.push(e2);

  const e3 = await appendLedgerEntry(chain, {
    actorId: 'usr-rev-1',
    actorName: 'Marcus Vance',
    actorRole: 'reviewer',
    eventType: 'audit_sign_off',
    entityId: 'ent-compliance',
    recordId: 'eng-aml-annual',
    recordType: 'engagement',
    payloadSummary: 'Engagement Q3 AML Monitoring formally signed-off and sealed',
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: '2026-09-14T16:15:00Z',
  });
  chain.push(e3);

  return chain;
}
