/**
 * Connector-runtime data layer (stream S5 — C1 / C3).
 *
 * Mount point (docs/build/OWNERSHIP.md §4.2): created empty so `src/data/index.ts` is complete before
 * any stream branches. Stream S5 fills this module; no other stream edits it.
 *
 * This is the only place a connector run talks to the database. A run is started with
 * `connector_run_start`, each mapped record is written with `staged_record_ingest` (idempotent by
 * content hash), and the run is closed with `connector_run_finish`. Every write goes through a
 * security-definer RPC that checks the org guard; a component never imports the Supabase client.
 *
 * The orchestration (`runConnector`) is the caller that makes `connector_run_start` /
 * `staged_record_ingest` / `connector_run_finish` reachable from the mounted connector screen. The
 * fetch and the mapping are the pure functions in `src/lib/writing/connectors`; this module only
 * writes their output through the RPCs, and it takes the time as an argument.
 */
import { getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import type { Connector, ConnectorInstance, Transport } from '../lib/writing/connectors';

const NOT_CONFIGURED = 'The connector-runtime module is not configured.';

/** Call an RPC and return its scalar value, or a refusal with the database's reason. */
async function callRpcValue<T>(name: string, args: Record<string, unknown>, reason = NOT_CONFIGURED_REASON):
Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason };
  const { data, error } = await sb.rpc(name, args);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, value: data as T };
}

/** Start a run for a connector instance. Returns the run id, or a refusal with its reason. */
export async function startConnectorRun(
  orgId: string, instanceId: string,
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const r = await callRpcValue<string>('connector_run_start', { p_org: orgId, p_instance_id: instanceId });
  if (!r.ok) return r;
  if (!r.value) return { ok: false, reason: 'the run was not created' };
  return { ok: true, runId: r.value };
}

/** Close a run with its outcome and counts. A second finish is refused by 0169. */
export async function finishConnectorRun(
  orgId: string, runId: string,
  outcome: { status: 'succeeded' | 'failed'; fetched: number; staged: number; skipped: number; error?: string | null; detail?: string },
): Promise<DataResult> {
  const r = await callRpcValue<null>('connector_run_finish', {
    p_org: orgId, p_run_id: runId, p_status: outcome.status,
    p_fetched: outcome.fetched, p_staged: outcome.staged, p_skipped: outcome.skipped,
    p_error: outcome.error ?? null, p_detail: outcome.detail ?? '',
  });
  return r.ok ? { ok: true } : r;
}

/** Stage one mapped record. Idempotent by content hash: the same record stages once (`inserted` false). */
export async function ingestStagedRecord(
  orgId: string, instanceId: string, runId: string | null,
  record: { source: string; sourceId: string; contentHash: string; fetchedAt: string;
    values: Record<string, string | number | boolean>; tags?: string[] },
): Promise<{ ok: true; inserted: boolean } | { ok: false; reason: string }> {
  const r = await callRpcValue<boolean>('staged_record_ingest', {
    p_org: orgId, p_instance_id: instanceId, p_run_id: runId, p_source: record.source,
    p_source_id: record.sourceId, p_content_hash: record.contentHash, p_fetched_at: record.fetchedAt,
    p_values: record.values, p_tags: record.tags ?? [],
  });
  if (!r.ok) return r;
  return { ok: true, inserted: r.value === true };
}

export interface RunConnectorInput {
  orgId: string;
  connector: Connector;
  instance: ConnectorInstance;
  transport: Transport;
  /** The instant the fetch is recorded at. Time is an argument; nothing here reads the clock. */
  fetchedAt: string;
}

export interface RunConnectorResult {
  ok: boolean;
  reason?: string;
  runId: string | null;
  fetched: number;
  staged: number;
  skipped: number;
}

/**
 * Run one connector instance end to end: start the run, fetch through the transport, map each row to
 * a staged record, ingest it, and close the run with the counts.
 *
 * A refusal at any step still closes the run as failed with the reason, so the run history shows what
 * happened and the instance is never left 'running'. If the fetch itself throws, the run is closed
 * failed and the failure is reported — never swallowed.
 */
export async function runConnector(input: RunConnectorInput): Promise<RunConnectorResult> {
  const { orgId, connector, instance, transport, fetchedAt } = input;
  const started = await startConnectorRun(orgId, instance.id);
  if (!started.ok) {
    return { ok: false, reason: started.reason, runId: null, fetched: 0, staged: 0, skipped: 0 };
  }
  const runId = started.runId;

  let records: Array<Record<string, unknown>>;
  try {
    const result = await connector.fetch(instance, transport);
    records = result.records;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'the fetch failed';
    await finishConnectorRun(orgId, runId, { status: 'failed', fetched: 0, staged: 0, skipped: 0, error: reason, detail: reason });
    return { ok: false, reason, runId, fetched: 0, staged: 0, skipped: 0 };
  }

  let staged = 0;
  let skipped = 0;
  for (const row of records) {
    const record = await connector.map(row, instance, fetchedAt, runId);
    const written = await ingestStagedRecord(orgId, instance.id, runId, record);
    if (!written.ok) {
      await finishConnectorRun(orgId, runId, {
        status: 'failed', fetched: records.length, staged, skipped, error: written.reason, detail: written.reason,
      });
      return { ok: false, reason: written.reason, runId, fetched: records.length, staged, skipped };
    }
    if (written.inserted) staged++; else skipped++;
  }

  const detail = `fetched ${records.length}, staged ${staged}, skipped ${skipped}`;
  const closed = await finishConnectorRun(orgId, runId, {
    status: 'succeeded', fetched: records.length, staged, skipped, detail,
  });
  if (!closed.ok) {
    return { ok: false, reason: closed.reason, runId, fetched: records.length, staged, skipped };
  }
  return { ok: true, runId, fetched: records.length, staged, skipped };
}

/**
 * The transport a live run talks through: a `fetch` that sends only a read-only GET or a signed
 * POST, and only to a host on the tenant's egress allow-list. The allow-list is re-checked on the
 * server by the connector RPCs; this is the client-side half of the same rule, so an unlisted host
 * never even leaves the browser.
 */
export function browserTransport(allowedHosts: string[]): Transport {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return {
    async request(input) {
      if (input.method !== 'GET' && input.method !== 'POST') {
        throw new Error(`a connector transport is read-only: refused ${input.method}`);
      }
      const host = new URL(input.url).host.toLowerCase();
      if (!allowed.has(host)) throw new Error(`the host ${host} is not on the egress allow-list`);
      const res = await fetch(input.url, {
        method: input.method, headers: input.headers, body: input.body,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      return { status: res.status, headers, body: await res.text() };
    },
  };
}
