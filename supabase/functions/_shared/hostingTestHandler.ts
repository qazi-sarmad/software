/**
 * hosting-test handler (C2.1, S11, F16, F5, F8). The body of the Edge Function, with every
 * dependency injected so it can be tested without Deno, a network or a database.
 *
 * The function answers one question for a tenant's Org Admin: can this Postgres host Provio? It
 * reads the connection row and its password from the secret store with the service role (F5: the
 * password never leaves the server), opens a short-lived connection with a Postgres driver, and
 * reports what it found. It never returns the password, never logs it, and refuses an address that
 * is metadata or link-local (the same SSRF rule as the AI gateway, F8).
 *
 * Determinism (L1): the answer is a list of facts read from the server, not a score or a sample.
 * Nothing here uses randomness or a model.
 */
import {
  CORE_EXTENSIONS, MIN_FREE_SPACE_BYTES, MIN_SERVER_VERSION_NUM,
  OPTIONAL_EXTENSIONS, REQUIRED_EXTENSIONS, REQUIRED_ROLES,
} from './requiredHostingSpec.ts';
import { PRODUCT_NAME } from './productName.ts';

export interface Row { [key: string]: unknown; }

export interface QueryResult { data: Row | null; error: unknown; }

export interface RpcResult { data: unknown; error: unknown; }

/** The user's own client: it verifies the JWT and calls RPCs as that user. */
export interface CallerClientLike {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

/** The service client: it bypasses RLS, so it is used only after authorisation is proven. */
export interface ServiceClientLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): { limit(count: number): Promise<QueryResult> };
    };
  };
  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult>;
}

/** What a connected driver can report. `null` means the probe could not read that fact. */
export interface DriverReport {
  serverVersionNum: number | null;
  extensions: string[];
  roles: string[];
  freeSpaceBytes: number | null;
}

/** The driver: one connection attempt, one set of facts, then it is closed. */
export interface DriverLike {
  probe(connection: ConnectionSpec, timeoutMs: number): Promise<DriverReport>;
}

export interface ConnectionSpec {
  host: string;
  port: number;
  database: string;
  username: string;
  sslMode: string;
  password: string;
}

export interface HostingTestDeps {
  callerClient(authHeader: string): CallerClientLike;
  serviceClient(): ServiceClientLike;
  driver: DriverLike;
  now(): number;
  /** DNS answers for a hostname. Production passes the resolver; the check fails closed without one only for names. */
  resolveHost?(host: string): Promise<string[]>;
}

export interface HostingTestPayload {
  org_id?: string;
  connection_id?: string;
  consultation_session_id?: string;
}

export interface HostingTestReport {
  reachable: boolean;
  version: string | null;
  version_supported: boolean;
  extensions_present: string[];
  extensions_missing: string[];
  extensions_optional_missing: string[];
  roles_present: string[];
  roles_missing: string[];
  free_space_estimate: string | null;
  latency_ms: number | null;
  messages: string[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** The message of an RPC error, which the injected client types as unknown. */
function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return 'the request was refused';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** The default Postgres port when the row leaves it empty. */
const DEFAULT_PORT = 5432;
const PROBE_TIMEOUT_MS = 8000;

/**
 * Refuse an address that is not a tenant's own database. A metadata endpoint (169.254.0.0/16, the
 * cloud metadata service) or a link-local address would let a tenant make the platform probe the
 * platform itself (F8).
 */
export function addressIsForbidden(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return 'the connection has no host';
  if (h === 'localhost' || h === 'metadata' || h.endsWith('.internal') || h.endsWith('.local')) {
    return 'the host is a local or metadata address, which is not allowed';
  }
  // A bare IPv4 in the metadata or link-local range.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 169 && b === 254) return 'the host is the cloud metadata address, which is not allowed';
    if (a === 127) return 'the host is a loopback address, which is not allowed';
  }
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fd00:')) {
    return 'the host is a loopback or link-local address, which is not allowed';
  }
  return null;
}

function humanBytes(n: number): string {
  const gb = n / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/** Plain-language lines the screen shows. Never the password, never a stack trace. */
export function summarise(report: HostingTestReport): string[] {
  const out: string[] = [];
  if (!report.reachable) {
    out.push('The database could not be reached. Check the host, the port and that the database accepts connections from the platform.');
    return out;
  }
  let problems = false;
  if (!report.version_supported) {
    problems = true;
    out.push(`The server reports ${report.version ?? 'an unknown version'}. ${PRODUCT_NAME} needs PostgreSQL 14 or newer.`);
  }
  if (report.extensions_missing.length > 0) {
    problems = true;
    out.push(`These required extensions are missing: ${report.extensions_missing.join(', ')}.`);
  }
  if (report.extensions_optional_missing.length > 0) {
    out.push(`These optional extensions are missing, so scheduled jobs will not run: ${report.extensions_optional_missing.join(', ')}.`);
  }
  if (report.roles_missing.length > 0) {
    problems = true;
    out.push(`These roles are missing: ${report.roles_missing.join(', ')}.`);
  }
  if (report.free_space_estimate) {
    out.push(`Free space is about ${report.free_space_estimate}.`);
  }
  if (!problems) {
    out.unshift(`The database can host ${PRODUCT_NAME}. Every required extension and role is present.`);
  }
  return out;
}

function buildReport(
  reachable: boolean, driver: DriverReport | null, latencyMs: number | null,
): HostingTestReport {
  const present = (want: readonly string[], have: string[]) =>
    want.filter((e) => have.includes(e));
  const missing = (want: readonly string[], have: string[]) =>
    want.filter((e) => !have.includes(e));
  const have = driver?.extensions ?? [];
  const haveRoles = driver?.roles ?? [];
  const report: HostingTestReport = {
    reachable,
    version: driver?.serverVersionNum ? String(driver.serverVersionNum) : null,
    version_supported: driver?.serverVersionNum != null && driver.serverVersionNum >= MIN_SERVER_VERSION_NUM,
    extensions_present: present(REQUIRED_EXTENSIONS, have),
    extensions_missing: missing(CORE_EXTENSIONS, have),
    extensions_optional_missing: missing(OPTIONAL_EXTENSIONS, have),
    roles_present: present(REQUIRED_ROLES, haveRoles),
    roles_missing: missing(REQUIRED_ROLES, haveRoles),
    free_space_estimate: driver?.freeSpaceBytes != null ? humanBytes(driver.freeSpaceBytes) : null,
    latency_ms: latencyMs,
    messages: [],
  };
  report.messages = summarise(report);
  return report;
}

export function createHostingTestHandler(deps: HostingTestDeps) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ ok: false, reason: 'method not allowed' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }

    let body: HostingTestPayload;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, reason: 'a JSON body is required' }, 400);
    }

    const orgId = body.org_id ?? null;
    const connectionId = body.connection_id ?? null;
    if (!connectionId) return json({ ok: false, reason: 'a connection id is required' }, 400);

    // 1. Verify the caller and the configuration right, as the caller (F4/L5).
    const caller = deps.callerClient(authHeader);
    const { data: authUser, error: authErr } = await caller.auth.getUser();
    if (authErr || !authUser?.user) {
      return json({ ok: false, reason: 'a signed-in session is required' }, 401);
    }

    let authorised = false;
    if (orgId) {
      const { data: mode, error: modeErr } = await caller.rpc('config_write_mode', {
        p_org: orgId, p_right: 'edit_config',
      });
      if (modeErr) return json({ ok: false, reason: errorText(modeErr) }, 403);
      // Only 'apply' is direct authority; 'propose' goes through the consultation flow.
      authorised = mode === 'apply';
      if (authorised) {
        // The hosting_migration entitlement gates the feature (F25).
        const { data: hasFeature, error: featErr } = await caller.rpc('has_feature', {
          p_org: orgId, p_key: 'hosting_migration',
        });
        if (featErr) return json({ ok: false, reason: errorText(featErr) }, 403);
        if (hasFeature !== true) {
          return json({ ok: false, reason: 'not allowed: the hosting_migration feature is not enabled for this organisation' }, 403);
        }
      }
    } else {
      const { data: isAdmin, error: adminErr } = await caller.rpc('is_platform_admin');
      if (adminErr) return json({ ok: false, reason: errorText(adminErr) }, 403);
      authorised = isAdmin === true;
    }

    // A tier-1 consultation session lets the platform run the test while a tenant watches.
    if (!authorised && body.consultation_session_id) {
      const { data: active, error: consErr } = await caller.rpc('consultation_active', {
        p_org: orgId,
      });
      if (consErr) return json({ ok: false, reason: errorText(consErr) }, 403);
      const rows = Array.isArray(active) ? active : [];
      authorised = rows.some((r: Row) => r.id === body.consultation_session_id && r.status === 'active');
    }

    if (!authorised) {
      return json({ ok: false, reason: 'not allowed: the caller cannot test a connection for this organisation' }, 403);
    }

    // 2. Read the connection and its password with the service role, after authorisation.
    const service = deps.serviceClient();
    const { data: conn, error: connErr } = await service
      .from('hosting_connections')
      .select('id, org_id, host, port, database_name, username, ssl_mode, password_secret_id')
      .eq('id', connectionId)
      .limit(1);
    if (connErr) return json({ ok: false, reason: 'the connection could not be read' }, 500);
    if (!conn) return json({ ok: false, reason: 'no such connection' }, 404);
    if (orgId && conn.org_id !== orgId) {
      return json({ ok: false, reason: 'not allowed: the connection belongs to another organisation' }, 403);
    }

    const host = String(conn.host ?? '').trim();
    // Check the name and every address it resolves to. A name that resolves to a metadata, loopback
    // or link-local address is refused, which closes the DNS route around the literal check.
    let forbidden = addressIsForbidden(host);
    if (!forbidden && deps.resolveHost && !/^[0-9.]+$|:/.test(host)) {
      const answers = await deps.resolveHost(host).catch(() => [] as string[]);
      if (answers.length === 0) forbidden = 'the host did not resolve';
      for (const a of answers) {
        forbidden = forbidden ?? addressIsForbidden(a);
      }
    }
    if (forbidden) {
      const blocked = buildReport(false, null, null);
      blocked.messages = [forbidden];
      return json({ ok: false, reason: forbidden, report: blocked }, 400);
    }

    if (!conn.password_secret_id) {
      return json({ ok: false, reason: 'the connection has no stored password; save one first' }, 400);
    }
    const { data: password, error: pwErr } = await service.rpc('secret_reveal', {
      p_id: conn.password_secret_id,
    });
    if (pwErr || typeof password !== 'string' || !password) {
      return json({ ok: false, reason: 'the stored password could not be read' }, 500);
    }

    const spec: ConnectionSpec = {
      host,
      port: Number(conn.port ?? DEFAULT_PORT) || DEFAULT_PORT,
      database: String(conn.database_name ?? ''),
      username: String(conn.username ?? ''),
      sslMode: String(conn.ssl_mode ?? 'require'),
      password,
    };

    // 3. Probe. A failure is a report, not a thrown error, and it never carries the password.
    const started = deps.now();
    let report: HostingTestReport;
    try {
      const facts = await deps.driver.probe(spec, PROBE_TIMEOUT_MS);
      report = buildReport(true, facts, deps.now() - started);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      report = buildReport(false, null, null);
      // Plain language: the driver's message is about the connection, never the credentials.
      report.messages = [`The database could not be reached: ${reason}`];
      await record(service, connectionId, 'failed', report.messages.join(' '));
      return json({ ok: true, report });
    }

    const detail = report.messages.join(' ');
    await record(service, connectionId, report.reachable ? 'ok' : 'failed', detail);
    return json({ ok: true, report });
  };
}

/** Persist the outcome so OA-15 shows the last test without re-running it. */
async function record(
  service: ServiceClientLike, connectionId: string, result: string, detail: string,
): Promise<void> {
  await service.rpc('hosting_connection_test_result', {
    p_connection_id: connectionId,
    p_result: result,
    p_detail: detail.slice(0, 500),
  });
}
