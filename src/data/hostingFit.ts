/**
 * Hosting Fit and database mobility data module (F16, S11). Every call goes through a typed function
 * here; components never import the database client (rule M8).
 *
 * The secret password NEVER passes through this module as a SQL value: the caller stores it through
 * `storeSecret` (src/data/secrets.ts, the secrets-put Edge Function) and links the returned id with
 * `setConnectionSecret`. This module keeps only ids and masks (F5).
 */
import { getClient } from './db';
import type { CostTier, FitAnswers, FitResult, FitRule, FitSeverity, StackOption } from '../lib/hostingFit';

const NOT_CONFIGURED = 'The Hosting module is not configured.';

export interface HostingCatalogue {
  catalogue: StackOption[];
  rules: FitRule[];
}

export interface HostingConnection {
  id: string;
  label: string;
  kind: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  sslMode: string;
  passwordMasked: string | null;
  lastTestAt: string | null;
  lastTestResult: string | null;
  lastTestDetail: string | null;
}

export interface MigrationStepRow {
  stepNo: number;
  stepKey: string;
  status: string;
  rowsDone: number;
  detail: string | null;
}

export interface MigrationJob {
  id: string;
  connectionId: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  rowsDone: number;
  errorText: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retentionDays: number;
  retireAfter: string | null;
  createdAt: string;
  steps: MigrationStepRow[];
}

interface RawRule {
  key: string;
  field: string;
  operator: string;
  value: string | null;
  severity: string;
  message: string | null;
  costTier: string;
  enabled: boolean;
}

function toRule(raw: RawRule): FitRule {
  return {
    key: raw.key,
    field: raw.field,
    operator: raw.operator,
    value: raw.value,
    severity: (raw.severity as FitSeverity) ?? 'info',
    message: raw.message ?? '',
    costTier: (raw.costTier as CostTier) ?? 'standard',
    enabled: raw.enabled !== false,
  };
}

/** Read the seeded stack catalogue and the editable rules (SA-10, SA-11). Platform admin only. */
export async function getHostingCatalogue(): Promise<HostingCatalogue> {
  const sb = getClient();
  if (!sb) return { catalogue: [], rules: [] };
  const { data, error } = await sb.rpc('hosting_fit_get');
  if (error) throw new Error(error.message);
  const raw = data as { catalogue?: StackOption[]; rules?: RawRule[] } | null;
  return {
    catalogue: (raw?.catalogue ?? []).map((s) => ({
      key: s.key, label: s.label, aliases: s.aliases ?? [], engine: s.engine,
      hostingKind: s.hostingKind, notes: s.notes ?? '', isSupported: s.isSupported !== false,
    })),
    rules: (raw?.rules ?? []).map(toRule),
  };
}

/** Edit one rule visually (SA-11). Never a JSON field. */
export async function saveHostingRule(rule: FitRule): Promise<void> {
  const sb = getClient();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const { error } = await sb.rpc('hosting_fit_rule_save', {
    p_rule_key: rule.key, p_field: rule.field, p_operator: rule.operator,
    p_value: rule.value, p_severity: rule.severity, p_message: rule.message,
    p_cost_tier: rule.costTier, p_enabled: rule.enabled,
  });
  if (error) throw new Error(error.message);
}

export async function listHostingConnections(orgId: string): Promise<HostingConnection[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('hosting_connection_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as HostingConnection[];
}

/** Save the connection fields (no password here). Returns the connection id. */
export async function saveHostingConnection(input: {
  orgId: string; label: string; kind: string; host: string; port: number | null;
  database: string; username: string; sslMode: string;
}): Promise<string> {
  const sb = getClient();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const { data, error } = await sb.rpc('hosting_connection_save', {
    p_org: input.orgId, p_label: input.label, p_kind: input.kind, p_host: input.host,
    p_port: input.port, p_database: input.database, p_username: input.username, p_ssl_mode: input.sslMode,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Link a secret stored through secrets-put to a connection (F5: no plaintext through SQL). */
export async function setConnectionSecret(connectionId: string, secretId: string, masked: string): Promise<void> {
  const sb = getClient();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const { error } = await sb.rpc('hosting_connection_set_secret', {
    p_connection_id: connectionId, p_secret_id: secretId, p_masked: masked,
  });
  if (error) throw new Error(error.message);
}

export async function createMigrationJob(orgId: string, connectionId: string, retentionDays = 14): Promise<{ jobId: string; jobToken: string }> {
  const sb = getClient();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const { data, error } = await sb.rpc('migration_job_create', {
    p_org: orgId, p_connection_id: connectionId, p_retention_days: retentionDays,
  });
  if (error) throw new Error(error.message);
  return data as { jobId: string; jobToken: string };
}

export async function listMigrationJobs(orgId: string): Promise<MigrationJob[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('migration_job_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []) as MigrationJob[];
}

/** The Node command the operator runs, with the short-lived job token (F16). */
export function migrationRunnerCommand(jobId: string, jobToken: string): string {
  return `node tools/migration-runner/index.mjs --job ${jobId} --token ${jobToken}`;
}

export type { FitAnswers, FitResult, FitRule };
