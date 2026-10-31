/**
 * Readiness and complaint data module (D12, docs/SYSTELIGON-REMAINDER-BUILDER-PROMPT.md D12).
 *
 * The screen surface for the readiness traffic signals, the self-diagnostic and the complaint
 * register. Reads use the platform/org RPCs (migration 0160/0161), which decide the caller's rights
 * in the database; writes go through the complaint RPCs, which re-check the right server-side.
 *
 * Pure data: no React, no clock. A signal's verdict is decided in the database, never here, so the
 * browser cannot turn an amber check green.
 */
import { callRpcJson, getClient, type DataResult } from './db';

export type Verdict = 'green' | 'amber' | 'red';
export type SignalLayer = 'platform' | 'environment' | 'organisation';
export type Severity = 'critical' | 'warning';

export interface ReadinessSignal {
  signalId: string;
  label: string;
  layer: SignalLayer;
  severity: Severity;
  verdict: Verdict;
  reason: string;
  remediation: string;
  fixTarget: string;
}

export interface ReadinessReport {
  orgId: string;
  scope: 'platform' | 'organisation';
  signals: ReadinessSignal[];
  summary: { green: number; amber: number; red: number };
}

export interface DiagnosticResult {
  signalId: string;
  label: string;
  layer: SignalLayer;
  verdict: Verdict;
  reason: string;
  evidence: string;
  remediation: string;
  fixTarget: string;
  recorded: boolean;
}

export interface ComplaintRow {
  id: string;
  code: string;
  severity: Severity;
  sourceSignal: string | null;
  title: string;
  body: string;
  status: 'open' | 'assigned' | 'resolved';
  assignedTo: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

export interface ComplaintEvent {
  kind: string;
  detail: Record<string, unknown>;
  ts: string;
}

/** Map one raw signal object onto the typed shape. Exported so a test can prove the mapping. */
export function mapReadinessSignal(raw: Record<string, unknown>): ReadinessSignal {
  return {
    signalId: String(raw.signal_id),
    label: String(raw.label ?? ''),
    layer: (raw.layer as SignalLayer) ?? 'organisation',
    severity: (raw.severity as Severity) ?? 'warning',
    verdict: (raw.verdict as Verdict) ?? 'amber',
    reason: String(raw.reason ?? ''),
    remediation: String(raw.remediation ?? ''),
    fixTarget: String(raw.fix_target ?? ''),
  };
}

function mapReport(raw: Record<string, unknown>): ReadinessReport {
  const summary = (raw.summary ?? {}) as Record<string, unknown>;
  return {
    orgId: String(raw.org_id ?? ''),
    scope: (raw.scope as 'platform' | 'organisation') ?? 'organisation',
    signals: ((raw.signals ?? []) as Record<string, unknown>[]).map(mapReadinessSignal),
    summary: {
      green: Number(summary.green ?? 0),
      amber: Number(summary.amber ?? 0),
      red: Number(summary.red ?? 0),
    },
  };
}

export function mapComplaint(raw: Record<string, unknown>): ComplaintRow {
  return {
    id: String(raw.id),
    code: String(raw.code ?? ''),
    severity: (raw.severity as Severity) ?? 'warning',
    sourceSignal: (raw.source_signal as string | null) ?? null,
    title: String(raw.title ?? ''),
    body: String(raw.body ?? ''),
    status: (raw.status as ComplaintRow['status']) ?? 'open',
    assignedTo: (raw.assigned_to as string | null) ?? null,
    createdAt: String(raw.created_at ?? ''),
    resolvedAt: (raw.resolved_at as string | null) ?? null,
    resolutionReason: (raw.resolution_reason as string | null) ?? null,
  };
}

/** The platform readiness view for one organisation. Empty report when the module is not configured. */
export async function platformReadiness(orgId: string): Promise<ReadinessReport> {
  const res = await callRpcJson('platform_readiness_signals', { p_org: orgId });
  if (!res.ok) throw new Error(res.reason);
  return mapReport(res.data);
}

/** The organisation-level readiness view for the caller's own org (environment signals are omitted). */
export async function orgReadiness(): Promise<ReadinessReport> {
  const res = await callRpcJson('org_readiness_signals', {});
  if (!res.ok) throw new Error(res.reason);
  return mapReport(res.data);
}

/** Re-run one signal in isolation. Records its result; changes no state. */
export async function runDiagnostic(orgId: string, signalId: string): Promise<DiagnosticResult> {
  const res = await callRpcJson('run_readiness_diagnostic', { p_org: orgId, p_signal: signalId });
  if (!res.ok) throw new Error(res.reason);
  const d = res.data as Record<string, unknown>;
  return {
    signalId: String(d.signal_id),
    label: String(d.label ?? ''),
    layer: (d.layer as SignalLayer) ?? 'organisation',
    verdict: (d.verdict as Verdict) ?? 'amber',
    reason: String(d.reason ?? ''),
    evidence: String(d.evidence ?? ''),
    remediation: String(d.remediation ?? ''),
    fixTarget: String(d.fix_target ?? ''),
    recorded: Boolean(d.recorded),
  };
}

/** Re-run one organisation signal in isolation for the caller's own org. */
export async function runOrgDiagnostic(signalId: string): Promise<DiagnosticResult> {
  const res = await callRpcJson('org_run_readiness_diagnostic', { p_signal: signalId });
  if (!res.ok) throw new Error(res.reason);
  const d = res.data as Record<string, unknown>;
  return {
    signalId: String(d.signal_id),
    label: String(d.label ?? ''),
    layer: (d.layer as SignalLayer) ?? 'organisation',
    verdict: (d.verdict as Verdict) ?? 'amber',
    reason: String(d.reason ?? ''),
    evidence: String(d.evidence ?? ''),
    remediation: String(d.remediation ?? ''),
    fixTarget: String(d.fix_target ?? ''),
    recorded: Boolean(d.recorded),
  };
}

/** Raise a complaint for one organisation (platform path). Returns the minted code, or the refusal. */
export async function createComplaint(
  orgId: string, title: string, signals: string[], severity: Severity, body: string
): Promise<{ ok: true; code: string; complaintId: string } | { ok: false; reason: string }> {
  const res = await callRpcJson('complaint_create', {
    p_org: orgId, p_title: title, p_signals: signals, p_severity: severity, p_body: body,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const d = res.data as Record<string, unknown>;
  return { ok: true, code: String(d.code ?? ''), complaintId: String(d.complaint_id ?? '') };
}

/** Raise a complaint about the caller's own organisation (tenant path). */
export async function createOrgComplaint(
  title: string, signals: string[], severity: Severity, body: string
): Promise<{ ok: true; code: string; complaintId: string } | { ok: false; reason: string }> {
  const res = await callRpcJson('org_complaint_create', {
    p_title: title, p_signals: signals, p_severity: severity, p_body: body,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const d = res.data as Record<string, unknown>;
  return { ok: true, code: String(d.code ?? ''), complaintId: String(d.complaint_id ?? '') };
}

/** The platform complaint register, optionally filtered to one organisation. */
export async function listComplaints(orgId?: string): Promise<ComplaintRow[]> {
  const res = await callRpcJson('complaint_list', { p_org: orgId ?? null });
  if (!res.ok) throw new Error(res.reason);
  return ((res.data as unknown as Record<string, unknown>[]) ?? []).map(mapComplaint);
}

/** The caller's own organisation's complaints. */
export async function listOrgComplaints(): Promise<ComplaintRow[]> {
  const res = await callRpcJson('org_complaint_list', {});
  if (!res.ok) throw new Error(res.reason);
  return ((res.data as unknown as Record<string, unknown>[]) ?? []).map(mapComplaint);
}

/** The append-only event trail for one complaint. */
export async function listComplaintEvents(complaintId: string): Promise<ComplaintEvent[]> {
  const res = await callRpcJson('complaint_events_list', { p_complaint: complaintId });
  if (!res.ok) throw new Error(res.reason);
  return ((res.data as unknown as Record<string, unknown>[]) ?? []).map((e) => ({
    kind: String(e.kind ?? ''),
    detail: (e.detail as Record<string, unknown>) ?? {},
    ts: String(e.ts ?? ''),
  }));
}

export async function assignComplaint(complaintId: string, assignee: string, reason: string): Promise<DataResult> {
  const res = await callRpcJson('complaint_assign', {
    p_complaint: complaintId, p_assignee: assignee, p_reason: reason,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function commentComplaint(complaintId: string, body: string): Promise<DataResult> {
  const res = await callRpcJson('complaint_comment', { p_complaint: complaintId, p_body: body });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

export async function resolveComplaint(complaintId: string, reason: string): Promise<DataResult> {
  const res = await callRpcJson('complaint_resolve', { p_complaint: complaintId, p_reason: reason });
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** The platform administrators' user ids, for the assignment picker. Empty when not configured. */
export async function listPlatformAdmins(): Promise<{ id: string; email: string }[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('platform_list_admins');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: String(a.user_id ?? a.id ?? ''),
    email: String(a.email ?? ''),
  }));
}
