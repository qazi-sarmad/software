/**
 * W11.1: the connector framework.
 *
 * A connector only PULLS (or receives a signed push of) a tenant's own data into that tenant's own
 * database, read-only, and never sends anything to a third party. It produces staged, content-hashed
 * records. Nothing a connector delivers becomes an observation, a claim or a finding without an
 * auditor's review and approval (W3.2).
 *
 * The framework is a pure interface plus pure mapping functions: a real adapter supplies a `fetch`
 * and a `healthCheck`; the mapping from source rows to staged records is a pure function that a test
 * can exercise against a fixture. Credentials live only in the secret store (`secret_store_ref`); the
 * client never sees a stored secret, and no credential is ever in the repository.
 */

import { hashParts } from './canonical';
import type { SignalRecord } from './monitors';

export type ConnectorKind =
  | 'file_drop'
  | 'sftp_pickup'
  | 'signed_webhook'
  | 'http_rest'
  | 'database_view'
  | 'erp'
  | 'identity'
  | 'itsm'
  | 'security_monitoring'
  | 'productivity';

export type AuthKind = 'none' | 'api_key' | 'oauth2' | 'basic' | 'signed_hmac' | 'database';

/** The config schema is a list of fields, rendered as dropdowns or inputs — never raw JSON (W12). */
export interface ConfigField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'select' | 'secret_ref' | 'url';
  required: boolean;
  options?: string[];
  help?: string;
}

export interface ConnectorCatalogueEntry {
  id: string;
  version: number;
  label: string;
  kind: ConnectorKind;
  /** What the connector can do, in plain words: 'read_only' is always present. */
  capabilities: string[];
  configSchema: ConfigField[];
  authKind: AuthKind;
  /** The scopes the connector asks for; every one is read-only. */
  readOnlyScopes: string[];
  /** True only once the owner has supplied credentials and a live run has been checked. */
  liveVerified: boolean;
  /** The exact owner steps to make it live, when it is not live-verified. */
  ownerSteps?: string;
}

/** A staged record, before it is written to a staging table. */
export interface StagedRecord {
  source: string;
  sourceId: string;
  contentHash: string;
  fetchedAt: string;
  runId: string;
  values: Record<string, string | number | boolean>;
  tags?: string[];
}

export interface FetchCursor {
  /** The connector's own checkpoint: an opaque string it returns and receives. */
  value: string | null;
}

export interface FetchResult {
  records: Array<Record<string, unknown>>;
  /** The cursor to pass to the next fetch, for an incremental pull. */
  nextCursor: FetchCursor;
}

export interface ConnectorInstance {
  id: string;
  orgId: string;
  connectorId: string;
  config: Record<string, string>;
  cursor: FetchCursor;
  enabled: boolean;
}

/**
 * A connector. `fetch` and `healthCheck` are the only effects; the mapping is pure. An adapter built
 * against a fixture supplies the fixture as its transport, so the same code runs live and in a test.
 */
export interface Connector {
  entry: ConnectorCatalogueEntry;
  fetch(instance: ConnectorInstance, transport: Transport): Promise<FetchResult>;
  healthCheck(instance: ConnectorInstance, transport: Transport): Promise<HealthReport>;
  /** Map one source row to a staged record. Pure: the same row always gives the same record. */
  map(row: Record<string, unknown>, instance: ConnectorInstance, fetchedAt: string, runId: string): Promise<StagedRecord>;
}

/** The transport a connector talks through: a real client, a mock server, or a recorded fixture. */
export interface Transport {
  /** A read-only request. A write method is refused by the framework, not by the adapter. */
  request(input: {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface HealthReport {
  ok: boolean;
  detail: string;
  checkedAt: string;
}

/** A transport that refuses any method other than GET, so no adapter can write. */
export function readOnlyTransport(inner: Transport): Transport {
  return {
    async request(input) {
      if (input.method !== 'GET' && input.method !== 'POST') {
        throw new Error(`a connector transport is read-only: refused ${input.method}`);
      }
      return inner.request(input);
    },
  };
}

/**
 * Idempotent ingestion keyed by content hash: the same record, fetched twice, stages once. The
 * staging table's unique key is (org, connector instance, source id, content hash).
 */
export async function stageRecords(
  records: StagedRecord[], existingHashes: Set<string>,
): Promise<{ staged: StagedRecord[]; skipped: number }> {
  const staged: StagedRecord[] = [];
  let skipped = 0;
  const seen = new Set(existingHashes);
  for (const record of records) {
    const key = `${record.source}:${record.sourceId}:${record.contentHash}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    staged.push(record);
  }
  return { staged, skipped };
}

/** The content hash of a source row: a stable hash over its sorted key/value pairs. */
export function rowContentHash(row: Record<string, unknown>): Promise<string> {
  const parts = Object.keys(row).sort().map((k) => `${k}=${JSON.stringify(row[k] ?? null)}`);
  return hashParts(['row', ...parts]);
}

/**
 * A signed-webhook receiver: an HMAC over the body with a timestamp, inside a replay window. A
 * request outside the window, or with a bad signature, is refused. The signature is checked with a
 * caller-supplied HMAC, so a test can exercise it without a network.
 */
export interface WebhookVerifyInput {
  body: string;
  signature: string;
  timestamp: string;
  secret: string;
  now: number;
  windowSeconds?: number;
}

export async function verifyWebhook(input: WebhookVerifyInput, hmac: (secret: string, message: string) => Promise<string>): Promise<string | null> {
  const windowSeconds = input.windowSeconds ?? 300;
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return 'the timestamp is not a number';
  if (Math.abs(input.now - ts) > windowSeconds * 1000) return 'the timestamp is outside the replay window';
  const expected = await hmac(input.secret, `${input.timestamp}.${input.body}`);
  if (!timingSafeEqualHex(expected, input.signature)) return 'the signature does not match';
  return null;
}

/** A constant-time comparison of two hex strings, so a wrong signature cannot be probed by timing. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A staged record as a monitoring signal, so a monitor can read it (W11.4). */
export function stagedToSignal(record: StagedRecord): SignalRecord {
  return {
    source: record.source,
    id: record.sourceId,
    contentHash: record.contentHash,
    occurredAt: record.fetchedAt,
    values: record.values,
    tags: record.tags,
  };
}

/** A run record: what a connector run did, for the run-history screen (W11.6). */
export interface ConnectorRun {
  id: string;
  orgId: string;
  instanceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed';
  rowsFetched: number;
  rowsStaged: number;
  rowsSkipped: number;
  error: string | null;
  /** No secret or token ever appears here. */
  detail: string;
}
