/**
 * Writing-engine data module (W12, spec §15.6).
 *
 * The only place the writing-engine screens talk to the database. Components never import the
 * Supabase client. Reads use org-scoped RPCs and tables; every write goes through a security-definer
 * RPC that checks rights (0089, 0090) and the org guard.
 */
import { callRpc, getClient, type DataResult } from './db';
import { layoutFromRow, type FormatLayout } from '../lib/writing/reportFormat';

export interface PhraseRow {
  id: string;
  phraseId: string;
  version: number;
  template: string;
  claimLevel: string;
  formality: number;
  tone: number;
  voice: 'active' | 'passive';
  locale: string;
  status: 'draft' | 'reviewed' | 'released';
  bodyHash: string;
}

export interface CellReviewRow {
  phraseId: string;
  version: number;
  modelId: string;
  cellKey: string;
  status: 'unreviewed' | 'reviewed' | 'rejected';
}

export interface ConnectorInstanceRow {
  id: string;
  connectorId: string;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  health: string;
  healthDetail: string | null;
  lastCheckedAt: string | null;
}

export interface ConnectorRunRow {
  id: string;
  instanceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed';
  rowsFetched: number;
  rowsStaged: number;
  rowsSkipped: number;
  error: string | null;
  detail: string;
}

export interface StagedRecordRow {
  id: string;
  instanceId: string;
  source: string;
  sourceId: string;
  contentHash: string;
  fetchedAt: string;
  values: Record<string, unknown>;
  tags: string[];
}

export interface MonitorRuleRow {
  id: string;
  ruleId: string;
  version: number;
  kind: string;
  description: string;
  spec: Record<string, unknown>;
  status: 'draft' | 'released';
  bodyHash: string;
}

export interface AlertRow {
  alertId: string;
  ruleId: string;
  ruleVersion: number;
  kind: string;
  reason: string;
  evaluatedAt: string;
  disposition: 'open' | 'dismissed' | 'snoozed' | 'escalated';
  lineageHash: string;
  hash: string;
}

/** List the phrase library for the organisation. */
export async function listPhrases(orgId: string): Promise<PhraseRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('phrase_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), phraseId: String(r.phrase_id), version: Number(r.version),
    template: String(r.template), claimLevel: String(r.claim_level), formality: Number(r.formality),
    tone: Number(r.tone), voice: r.voice as 'active' | 'passive', locale: String(r.locale),
    status: r.status as PhraseRow['status'], bodyHash: String(r.body_hash),
  }));
}

/** The per-cell review status for the workbook. */
export async function listCellReviews(orgId: string): Promise<CellReviewRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('phrase_reviews')
    .select('phrase_id, version, model_id, cell_key, status')
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    phraseId: String(r.phrase_id), version: Number(r.version), modelId: String(r.model_id),
    cellKey: String(r.cell_key), status: r.status as CellReviewRow['status'],
  }));
}

/** Mark one workbook cell reviewed (W2.9). */
export async function reviewCell(
  orgId: string, phraseId: string, version: number, modelId: string, cellKey: string,
  status: CellReviewRow['status'],
): Promise<DataResult> {
  return callRpc('phrase_review_cell', {
    p_org: orgId, p_phrase_id: phraseId, p_version: version, p_model_id: modelId,
    p_cell_key: cellKey, p_status: status,
  });
}

/** Release a phrase once every workbook cell is reviewed (platform admin only). */
export async function releasePhrase(phraseRowId: string, expectedCells: number): Promise<DataResult> {
  return callRpc('phrase_release', { p_phrase_row: phraseRowId, p_expected_cells: expectedCells });
}

/** List connector instances. */
export async function listConnectorInstances(orgId: string): Promise<ConnectorInstanceRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('connector_instances')
    .select('id, connector_id, label, config, enabled, health, health_detail, last_checked_at')
    .eq('org_id', orgId).order('connector_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), connectorId: String(r.connector_id), label: String(r.label),
    config: (r.config ?? {}) as Record<string, unknown>, enabled: Boolean(r.enabled),
    health: String(r.health), healthDetail: r.health_detail as string | null,
    lastCheckedAt: r.last_checked_at as string | null,
  }));
}

/** Save a connector instance (edit_config). The credential is a reference, never a value. */
export async function saveConnectorInstance(
  orgId: string, instanceId: string | null, connectorId: string, label: string,
  config: Record<string, unknown>, credentialRef: string | null,
): Promise<DataResult> {
  return callRpc('connector_instance_save', {
    p_org: orgId, p_instance_id: instanceId, p_connector_id: connectorId, p_label: label,
    p_config: config, p_credential_ref: credentialRef,
  });
}

/** The run history for one instance. */
export async function listConnectorRuns(orgId: string, instanceId?: string): Promise<ConnectorRunRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('connector_runs')
    .select('id, instance_id, started_at, finished_at, status, rows_fetched, rows_staged, rows_skipped, error, detail')
    .eq('org_id', orgId).order('started_at', { ascending: false }).limit(50);
  if (instanceId) q = q.eq('instance_id', instanceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), instanceId: String(r.instance_id), startedAt: String(r.started_at),
    finishedAt: r.finished_at as string | null, status: r.status as ConnectorRunRow['status'],
    rowsFetched: Number(r.rows_fetched), rowsStaged: Number(r.rows_staged),
    rowsSkipped: Number(r.rows_skipped), error: r.error as string | null, detail: String(r.detail),
  }));
}

/** Browse staged records. */
export async function listStagedRecords(orgId: string, instanceId?: string): Promise<StagedRecordRow[]> {
  const sb = getClient();
  if (!sb) return [];
  let q = sb.from('staged_records')
    .select('id, instance_id, source, source_id, content_hash, fetched_at, values, tags')
    .eq('org_id', orgId).order('fetched_at', { ascending: false }).limit(200);
  if (instanceId) q = q.eq('instance_id', instanceId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), instanceId: String(r.instance_id), source: String(r.source),
    sourceId: String(r.source_id), contentHash: String(r.content_hash), fetchedAt: String(r.fetched_at),
    values: (r.values ?? {}) as Record<string, unknown>, tags: (r.tags ?? []) as string[],
  }));
}

/** List monitor rules. */
export async function listMonitorRules(orgId: string): Promise<MonitorRuleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('monitor_rules')
    .select('id, rule_id, version, kind, description, spec, status, body_hash')
    .eq('org_id', orgId).order('rule_id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), ruleId: String(r.rule_id), version: Number(r.version), kind: String(r.kind),
    description: String(r.description), spec: (r.spec ?? {}) as Record<string, unknown>,
    status: r.status as MonitorRuleRow['status'], bodyHash: String(r.body_hash),
  }));
}

/** Save a monitor rule as a draft (edit_config). */
export async function saveMonitorRule(
  orgId: string, ruleId: string, kind: string, description: string,
  spec: Record<string, unknown>, bodyHash: string,
): Promise<DataResult> {
  return callRpc('monitor_rule_save', {
    p_org: orgId, p_rule_id: ruleId, p_kind: kind, p_description: description,
    p_spec: spec, p_body_hash: bodyHash,
  });
}

/** Release a monitor rule (platform admin only). */
export async function releaseMonitorRule(ruleRowId: string): Promise<DataResult> {
  return callRpc('monitor_rule_release', { p_rule_row: ruleRowId });
}

/** The alert triage queue and the digest (M12). */
export async function listAlerts(orgId: string): Promise<AlertRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('alert_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    alertId: String(r.alert_id), ruleId: String(r.rule_id), ruleVersion: Number(r.rule_version),
    kind: String(r.kind), reason: String(r.reason), evaluatedAt: String(r.evaluated_at),
    disposition: r.disposition as AlertRow['disposition'], lineageHash: String(r.lineage_hash),
    hash: String(r.hash),
  }));
}

/** Triage an alert: dismiss with a reason, snooze with an expiry, or escalate. */
export async function triageAlert(
  orgId: string, alertId: string, disposition: AlertRow['disposition'],
  reason: string | null, snoozeUntil: string | null,
): Promise<DataResult> {
  return callRpc('alert_triage_record', {
    p_org: orgId, p_alert_id: alertId, p_disposition: disposition, p_reason: reason,
    p_snooze_until: snoozeUntil,
  });
}

/** The egress allow-list check, for the connector setup screen. */
export async function connectorEgressAllowed(orgId: string, host: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('connector_egress_allowed', { p_org: orgId, p_host: host });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Report formats (WRITE-1, owner instruction 2026-10-26). The per-client, versioned format editor.
// A format is presentation only: it never changes a claim or a figure, so the graph root is
// invariant across every format. Writes go through format_save / format_publish (edit_config).
// ---------------------------------------------------------------------------

export interface ReportFormatRow {
  id: string;
  formatKey: string;
  version: number;
  label: string;
  status: 'draft' | 'published';
  modelId: string;
  blocks: unknown[];
  layout: Record<string, unknown>;
  defaultLocale: 'en-GB' | 'en-US';
  bodyHash: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface FormatAudienceRow {
  roleSlug: string;
  canView: boolean;
  canEdit: boolean;
}

/** Every format version for the org, newest first. */
export async function listReportFormats(orgId: string): Promise<ReportFormatRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('format_list', { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id), formatKey: String(r.format_key), version: Number(r.version),
    label: String(r.label), status: r.status as ReportFormatRow['status'], modelId: String(r.model_id),
    blocks: (r.blocks ?? []) as unknown[], layout: (r.layout ?? {}) as Record<string, unknown>,
    defaultLocale: String(r.default_locale) as ReportFormatRow['defaultLocale'],
    bodyHash: String(r.body_hash), createdAt: String(r.created_at),
    publishedAt: r.published_at as string | null,
  }));
}

/** The audiences of one format version. */
export async function listFormatAudiences(formatId: string): Promise<FormatAudienceRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('format_audience_list', { p_format_id: formatId });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    roleSlug: String(r.role_slug), canView: Boolean(r.can_view), canEdit: Boolean(r.can_edit),
  }));
}

/**
 * The print layout the report editor prints with (WP-C3). The org's newest published format wins;
 * otherwise the newest version of any status; otherwise the defaults. Returns a complete, validated
 * layout, so the frozen PDF matches the format the client published. Pure merge is in
 * `layoutFromRow`; this only chooses which row to use.
 */
export async function getActiveReportLayout(orgId: string): Promise<FormatLayout> {
  const formats = await listReportFormats(orgId);
  const published = formats.filter((f) => f.status === 'published');
  const chosen = published[0] ?? formats[0];
  return layoutFromRow(chosen?.layout);
}

/** Save a format draft (edit_config). A published version is immutable; this creates the next one. */
export async function saveReportFormat(
  orgId: string, formatKey: string, modelId: string, label: string, blocks: unknown[],
  layout: Record<string, unknown>, defaultLocale: string, bodyHash: string,
): Promise<DataResult & { id?: string }> {
  return callRpc('format_save', {
    p_org: orgId, p_format_key: formatKey, p_model_id: modelId, p_label: label,
    p_blocks: blocks, p_layout: layout, p_default_locale: defaultLocale, p_body_hash: bodyHash,
  });
}

/** Publish a format version, refused while the editor reports validation issues (edit_config). */
export async function publishReportFormat(formatId: string, issueCount: number): Promise<DataResult> {
  return callRpc('format_publish', { p_format_id: formatId, p_issue_count: issueCount });
}

/** Replace the audience list for a format version (edit_config). Rights still decide at call time. */
export async function setFormatAudiences(
  formatId: string, audiences: FormatAudienceRow[],
): Promise<DataResult> {
  return callRpc('format_audience_set', { p_format_id: formatId, p_audiences: audiences });
}
