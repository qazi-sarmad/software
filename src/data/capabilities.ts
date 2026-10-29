/**
 * Capability library data module (D1-D4).
 *
 * The pure capability functions live in `src/lib/capabilities/`; this module is the only place the
 * capability screen talks to the database. It reads the org's thresholds and the append-only run
 * history, and records a run. The bytes of tenant rows never travel through here — a run stores the
 * input HASH and the derived findings, never the rows themselves (Law L2).
 *
 * With no Supabase environment every function is inert: reads return the documented defaults, a
 * write reports that the module is not configured. A component never imports the client.
 */
import { callRpc, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';

export type CapabilityKind = 'risk_control' | 'population_evidence' | 'process_governance' | 'assurance_ops';

/** The five capabilities each family exposes, for the screen's index. */
export const CAPABILITY_KINDS: { kind: CapabilityKind; label: string; summary: string }[] = [
  { kind: 'risk_control', label: 'Risk and control', summary: 'Residual-risk drift, coverage, effectiveness, key controls, appetite breach.' },
  { kind: 'population_evidence', label: 'Population and evidence', summary: 'Profile, stratification, sufficiency, freshness, chain of custody.' },
  { kind: 'process_governance', label: 'Process and governance', summary: 'Segregation of duties, delegation breach, exceptions, meetings, regulatory impact.' },
  { kind: 'assurance_ops', label: 'Assurance operations', summary: 'Engagement health, reviewer load, finding ageing, report consistency, trail completeness.' },
];

export interface CapabilityConfig {
  riskTolerance: 'low' | 'medium' | 'high' | 'critical';
  stratificationSample: number;
  reviewerAgeingDays: number;
}

/** The documented defaults, used when the module is inert or no row exists yet. */
export const DEFAULT_CAPABILITY_CONFIG: CapabilityConfig = {
  riskTolerance: 'high',
  stratificationSample: 25,
  reviewerAgeingDays: 14,
};

export interface CapabilityRunRow {
  id: string;
  kind: CapabilityKind;
  inputsHash: string;
  findingCount: number;
  createdAt: string;
}

/** Whether the capability library has a backing store, so the screen can say "not configured" honestly. */
export async function capabilityStorageReady(): Promise<boolean> {
  return getClient() !== null;
}

export async function getCapabilityConfig(): Promise<CapabilityConfig> {
  const sb = getClient();
  if (!sb) return { ...DEFAULT_CAPABILITY_CONFIG };
  const { data, error } = await sb.rpc('capability_config_get');
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!raw) return { ...DEFAULT_CAPABILITY_CONFIG };
  return {
    riskTolerance: (raw.risk_tolerance as CapabilityConfig['riskTolerance']) ?? 'high',
    stratificationSample: Number(raw.stratification_sample ?? 25),
    reviewerAgeingDays: Number(raw.reviewer_ageing_days ?? 14),
  };
}

export function saveCapabilityConfig(config: CapabilityConfig, reason: string): Promise<DataResult> {
  return callRpc('capability_config_save', {
    p_risk_tolerance: config.riskTolerance,
    p_stratification_sample: config.stratificationSample,
    p_reviewer_ageing_days: config.reviewerAgeingDays,
    p_reason: reason,
  });
}

export function recordCapabilityRun(
  kind: CapabilityKind, inputsHash: string, findings: Record<string, unknown>, findingCount: number
): Promise<DataResult> {
  return callRpc('capability_run_record', {
    p_kind: kind, p_inputs_hash: inputsHash, p_findings: findings, p_finding_count: findingCount,
  });
}

export async function listCapabilityRuns(kind?: CapabilityKind): Promise<CapabilityRunRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('capability_runs_list', { p_kind: kind ?? null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as CapabilityKind,
    inputsHash: r.inputs_hash as string,
    findingCount: Number(r.finding_count ?? 0),
    createdAt: r.created_at as string,
  }));
}

/**
 * A stable hash of the inputs a capability was run over, so a run can be matched to the exact input
 * set without storing it. SHA-256 over a canonical JSON serialisation. This is the same primitive
 * the population and evidence hashing already use — no new crypto.
 */
export async function hashCapabilityInputs(inputs: unknown): Promise<string> {
  const canonical = JSON.stringify(inputs, Object.keys(inputs as object).sort());
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { NOT_CONFIGURED_REASON };
