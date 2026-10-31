/**
 * W11.3: the connector catalogue and the concrete adapters.
 *
 * Every adapter here is built against a recorded fixture and a local mock server, so it runs with no
 * network and no credential. Each is marked "fixture-verified, live-verified: NO" until the owner
 * supplies credentials and a live run is checked. The catalogue entry carries the exact owner steps.
 *
 * The adapters share one shape: a `fetch` that reads rows through the transport, a `healthCheck`, and
 * a pure `map` that turns a source row into a staged, content-hashed record.
 */

import {
  Connector, ConnectorCatalogueEntry, ConnectorInstance, FetchResult, HealthReport, StagedRecord,
  Transport, rowContentHash,
} from './connectors';

const LIVE_NO = 'fixture-verified, live-verified: NO';

function entry(e: Omit<ConnectorCatalogueEntry, 'liveVerified' | 'capabilities'> & { capabilities?: string[] }): ConnectorCatalogueEntry {
  return { ...e, liveVerified: false, capabilities: ['read_only', ...(e.capabilities ?? [])] };
}

/** A mapping from a source field to a staged field, chosen through dropdowns (never raw JSON). */
export interface FieldMapping {
  from: string;
  to: string;
  kind: 'text' | 'number' | 'date' | 'boolean';
}

/** Apply a field mapping to a source row. Pure and total: a missing field becomes null. */
export function applyMapping(row: Record<string, unknown>, mapping: FieldMapping[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const m of mapping) {
    const raw = row[m.from];
    if (raw === undefined || raw === null) continue;
    switch (m.kind) {
      case 'number': out[m.to] = Number(raw); break;
      case 'boolean': out[m.to] = raw === true || raw === 'true' || raw === 1 || raw === '1'; break;
      default: out[m.to] = String(raw);
    }
  }
  return out;
}

interface AdapterSpec {
  id: string;
  label: string;
  kind: ConnectorCatalogueEntry['kind'];
  authKind: ConnectorCatalogueEntry['authKind'];
  configSchema: ConnectorCatalogueEntry['configSchema'];
  readOnlyScopes: string[];
  mapping: FieldMapping[];
  ownerSteps: string;
  capabilities?: string[];
  /** The path a fixture serves, and the JSON key that holds the rows. */
  rowsPath: string;
  rowsKey: string;
}

/** Build an adapter from a spec: the fetch and health check read the fixture path through the transport. */
function adapter(spec: AdapterSpec): Connector {
  const catalogueEntry = entry({
    id: spec.id,
    version: 1,
    label: spec.label,
    kind: spec.kind,
    configSchema: spec.configSchema,
    authKind: spec.authKind,
    readOnlyScopes: spec.readOnlyScopes,
    capabilities: spec.capabilities,
    ownerSteps: spec.ownerSteps,
  });
  return {
    entry: catalogueEntry,
    async fetch(instance: ConnectorInstance, transport: Transport): Promise<FetchResult> {
      const base = instance.config.base_url ?? '';
      const cursorParam = instance.cursor.value ? `?cursor=${encodeURIComponent(instance.cursor.value)}` : '';
      const res = await transport.request({ method: 'GET', url: `${base}${spec.rowsPath}${cursorParam}` });
      if (res.status >= 400) throw new Error(`${spec.id} returned ${res.status}`);
      const parsed = JSON.parse(res.body) as Record<string, unknown>;
      const rows = Array.isArray(parsed[spec.rowsKey]) ? parsed[spec.rowsKey] as Array<Record<string, unknown>> : [];
      const next = parsed.next_cursor === undefined || parsed.next_cursor === null ? null : String(parsed.next_cursor);
      return { records: rows, nextCursor: { value: next } };
    },
    async healthCheck(instance: ConnectorInstance, transport: Transport): Promise<HealthReport> {
      try {
        const res = await transport.request({ method: 'GET', url: `${instance.config.base_url ?? ''}${spec.rowsPath}?limit=1` });
        return { ok: res.status < 400, detail: res.status < 400 ? 'reachable, read-only' : `returned ${res.status}`, checkedAt: instance.config.checked_at ?? '' };
      } catch (e) {
        return { ok: false, detail: (e as Error).message, checkedAt: instance.config.checked_at ?? '' };
      }
    },
    async map(row: Record<string, unknown>, instance: ConnectorInstance, fetchedAt: string, runId: string): Promise<StagedRecord> {
      const values = applyMapping(row, spec.mapping);
      return {
        source: spec.id,
        sourceId: String(values.source_id ?? row.id ?? ''),
        contentHash: await rowContentHash(row),
        fetchedAt,
        runId,
        values,
        tags: typeof row.tags === 'string' ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      };
    },
  };
}

const BASE_URL_FIELD = {
  key: 'base_url', label: 'Base URL', kind: 'url' as const, required: true,
  help: 'The tenant system this connector pulls from. Read-only.',
};
const SECRET_FIELD = {
  key: 'credential_ref', label: 'Credential', kind: 'secret_ref' as const, required: true,
  help: 'Stored in the secret store. The client never sees it.',
};

const SPECS: AdapterSpec[] = [
  {
    id: 'file-drop',
    label: 'File drop (CSV, XLSX, JSON)',
    kind: 'file_drop',
    authKind: 'none',
    configSchema: [
      { key: 'path', label: 'Drop path', kind: 'text', required: true, help: 'A watched folder. Files are parsed with the existing import code.' },
      { key: 'format', label: 'Format', kind: 'select', required: true, options: ['csv', 'xlsx', 'json'] },
    ],
    readOnlyScopes: ['read:files'],
    mapping: [
      { from: 'id', to: 'source_id', kind: 'text' },
      { from: 'date', to: 'occurred_on', kind: 'date' },
      { from: 'amount', to: 'amount', kind: 'number' },
      { from: 'status', to: 'status', kind: 'text' },
    ],
    rowsPath: '/fixture/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Choose a watched folder and a format. No credential is needed. Test with a sample file in the folder.',
  },
  {
    id: 'sftp-pickup',
    label: 'SFTP-style pickup',
    kind: 'sftp_pickup',
    authKind: 'basic',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'remote_path', label: 'Remote path', kind: 'text', required: true }],
    readOnlyScopes: ['read:files'],
    mapping: [
      { from: 'id', to: 'source_id', kind: 'text' },
      { from: 'date', to: 'occurred_on', kind: 'date' },
    ],
    rowsPath: '/fixture/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Supply the SFTP host, a read-only user and its key (entered in the platform wizard, never in chat). Point it at the remote path and run a test fetch.',
  },
  {
    id: 'signed-webhook',
    label: 'Signed webhook receiver',
    kind: 'signed_webhook',
    authKind: 'signed_hmac',
    configSchema: [
      SECRET_FIELD,
      { key: 'signature_header', label: 'Signature header', kind: 'text', required: true, help: 'For example X-Signature-256.' },
      { key: 'replay_window_seconds', label: 'Replay window (seconds)', kind: 'number', required: true },
    ],
    readOnlyScopes: ['receive:webhook'],
    capabilities: ['receive_signed_push'],
    mapping: [
      { from: 'id', to: 'source_id', kind: 'text' },
      { from: 'event', to: 'event', kind: 'text' },
      { from: 'at', to: 'occurred_at', kind: 'date' },
    ],
    rowsPath: '/fixture/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Give the sender the webhook URL and the signing secret. The receiver checks the HMAC and the timestamp, and refuses a replay or a bad signature.',
  },
  {
    id: 'http-rest',
    label: 'HTTP REST pull',
    kind: 'http_rest',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'page_size', label: 'Page size', kind: 'number', required: true }],
    readOnlyScopes: ['read:data'],
    mapping: [
      { from: 'id', to: 'source_id', kind: 'text' },
      { from: 'value', to: 'value', kind: 'number' },
    ],
    rowsPath: '/fixture/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Supply the API base URL and a read-only API key. Set the page size and run a test fetch to confirm paging.',
  },
  {
    id: 'database-view',
    label: 'Read-only database view',
    kind: 'database_view',
    authKind: 'database',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'view_name', label: 'View', kind: 'text', required: true }],
    readOnlyScopes: ['read:view'],
    mapping: [
      { from: 'id', to: 'source_id', kind: 'text' },
      { from: 'amount', to: 'amount', kind: 'number' },
    ],
    rowsPath: '/fixture/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Supply a read-only Postgres connection (host, database, user). Grant SELECT on the view only.',
  },
  {
    id: 'sap-odata',
    label: 'SAP (OData)',
    kind: 'erp',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'entity', label: 'OData entity', kind: 'text', required: true }],
    readOnlyScopes: ['read:odata'],
    mapping: [
      { from: 'Id', to: 'source_id', kind: 'text' },
      { from: 'Amount', to: 'amount', kind: 'number' },
    ],
    rowsPath: '/sap/odata/rows.json',
    rowsKey: 'd.results',
    ownerSteps: 'Supply the SAP gateway base URL and an OAuth client with a read-only scope. Set the OData entity and run a test fetch.',
  },
  {
    id: 'oracle-erp',
    label: 'Oracle ERP',
    kind: 'erp',
    authKind: 'basic',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'resource', label: 'Resource', kind: 'text', required: true }],
    readOnlyScopes: ['read:erp'],
    mapping: [{ from: 'Id', to: 'source_id', kind: 'text' }],
    rowsPath: '/oracle/rows.json',
    rowsKey: 'items',
    ownerSteps: 'Supply the Oracle Fusion base URL and a read-only integration user.',
  },
  {
    id: 'dynamics-365',
    label: 'Microsoft Dynamics 365',
    kind: 'erp',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'entity_set', label: 'Entity set', kind: 'text', required: true }],
    readOnlyScopes: ['read:dataverse'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/dynamics/rows.json',
    rowsKey: 'value',
    ownerSteps: 'Supply the Dataverse environment URL and an app registration with a read-only role.',
  },
  {
    id: 'netsuite',
    label: 'NetSuite',
    kind: 'erp',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'record_type', label: 'Record type', kind: 'text', required: true }],
    readOnlyScopes: ['read:records'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/netsuite/rows.json',
    rowsKey: 'items',
    ownerSteps: 'Supply the NetSuite account and a token-based auth (consumer key, token id, token secret).',
  },
  {
    id: 'quickbooks-online',
    label: 'QuickBooks Online',
    kind: 'erp',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'realm', label: 'Realm', kind: 'text', required: true }],
    readOnlyScopes: ['read:accounting'],
    mapping: [{ from: 'Id', to: 'source_id', kind: 'text' }],
    rowsPath: '/qbo/rows.json',
    rowsKey: 'QueryResponse',
    ownerSteps: 'Supply the QuickBooks realm and an OAuth client with the accounting read scope.',
  },
  {
    id: 'xero',
    label: 'Xero',
    kind: 'erp',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'tenant_id', label: 'Xero tenant id', kind: 'text', required: true }],
    readOnlyScopes: ['read:accounting'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/xero/rows.json',
    rowsKey: 'Rows',
    ownerSteps: 'Supply the Xero tenant id and an OAuth client with the accounting read scope.',
  },
  {
    id: 'entra-id',
    label: 'Microsoft Entra ID',
    kind: 'identity',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'resource', label: 'Resource', kind: 'select', required: true, options: ['users', 'groups', 'signIns'] }],
    readOnlyScopes: ['read:directory'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/entra/rows.json',
    rowsKey: 'value',
    ownerSteps: 'Supply an app registration with Directory.Read.All and admin consent.',
  },
  {
    id: 'okta',
    label: 'Okta',
    kind: 'identity',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD],
    readOnlyScopes: ['read:users', 'read:logs'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/okta/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Supply the Okta org URL and a read-only API token.',
  },
  {
    id: 'scim-read',
    label: 'Generic SCIM read',
    kind: 'identity',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD],
    readOnlyScopes: ['read:scim'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/scim/rows.json',
    rowsKey: 'Resources',
    ownerSteps: 'Supply the SCIM base URL and a read-only bearer token.',
  },
  {
    id: 'servicenow',
    label: 'ServiceNow',
    kind: 'itsm',
    authKind: 'basic',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'table', label: 'Table', kind: 'text', required: true }],
    readOnlyScopes: ['read:table'],
    mapping: [{ from: 'sys_id', to: 'source_id', kind: 'text' }],
    rowsPath: '/servicenow/rows.json',
    rowsKey: 'result',
    ownerSteps: 'Supply the ServiceNow instance URL and a read-only user.',
  },
  {
    id: 'jira',
    label: 'Jira',
    kind: 'itsm',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'jql', label: 'JQL', kind: 'text', required: true }],
    readOnlyScopes: ['read:jira-work'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/jira/rows.json',
    rowsKey: 'issues',
    ownerSteps: 'Supply the Jira site URL, a read-only API token and a JQL filter.',
  },
  {
    id: 'splunk',
    label: 'Splunk',
    kind: 'security_monitoring',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'search', label: 'Saved search', kind: 'text', required: true }],
    readOnlyScopes: ['read:search'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/splunk/rows.json',
    rowsKey: 'results',
    ownerSteps: 'Supply the Splunk REST base URL and a read-only token. Set the saved search.',
  },
  {
    id: 'sentinel',
    label: 'Microsoft Sentinel',
    kind: 'security_monitoring',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'workspace', label: 'Workspace', kind: 'text', required: true }],
    readOnlyScopes: ['read:logs'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/sentinel/rows.json',
    rowsKey: 'tables',
    ownerSteps: 'Supply the Log Analytics workspace id and an app with the Log Analytics read role.',
  },
  {
    id: 'syslog-cef',
    label: 'Generic syslog / CEF receiver',
    kind: 'security_monitoring',
    authKind: 'signed_hmac',
    configSchema: [SECRET_FIELD, { key: 'listen_port', label: 'Listen port', kind: 'number', required: true }],
    readOnlyScopes: ['receive:syslog'],
    capabilities: ['receive_signed_push'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/syslog/rows.json',
    rowsKey: 'rows',
    ownerSteps: 'Give the sender the receiver host and port. Events are parsed from CEF and staged.',
  },
  {
    id: 'datadog-events',
    label: 'Datadog events',
    kind: 'security_monitoring',
    authKind: 'api_key',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'query', label: 'Event query', kind: 'text', required: true }],
    readOnlyScopes: ['events_read'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/datadog/rows.json',
    rowsKey: 'events',
    ownerSteps: 'Supply the Datadog site (for example datadoghq.com), an API key and an application key with events_read.',
  },
  {
    id: 'microsoft-graph',
    label: 'Microsoft Graph',
    kind: 'productivity',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, { key: 'resource', label: 'Resource', kind: 'select', required: true, options: ['auditLogs', 'users', 'groups'] }],
    readOnlyScopes: ['AuditLog.Read.All'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/graph/rows.json',
    rowsKey: 'value',
    ownerSteps: 'Reuses the existing Graph OAuth path. Grant AuditLog.Read.All and admin consent.',
  },
  {
    id: 'google-workspace',
    label: 'Google Workspace audit logs',
    kind: 'productivity',
    authKind: 'oauth2',
    configSchema: [BASE_URL_FIELD, SECRET_FIELD, { key: 'application', label: 'Application', kind: 'select', required: true, options: ['login', 'admin', 'drive', 'token'] }],
    readOnlyScopes: ['https://www.googleapis.com/auth/admin.reports.audit.readonly'],
    mapping: [{ from: 'id', to: 'source_id', kind: 'text' }],
    rowsPath: '/workspace/rows.json',
    rowsKey: 'items',
    ownerSteps: 'Supply a service account with domain-wide delegation and the audit read-only scope.',
  },
];

/** Every adapter, keyed by id. */
export const CONNECTORS: Connector[] = SPECS.map(adapter);

export function connectorById(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.entry.id === id);
}

/** The catalogue, with the live-verified state and the owner steps, for docs/CONNECTORS.md. */
export function catalogue(): ConnectorCatalogueEntry[] {
  return CONNECTORS.map((c) => c.entry);
}

/** The live-verified marker every adapter carries until the owner supplies credentials. */
export const LIVE_NOT_VERIFIED = LIVE_NO;
