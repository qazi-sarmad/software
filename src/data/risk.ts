/**
 * Risk / classification / planning data layer (stream S3 — D10 / D14 / D15).
 *
 * Mount point (docs/build/OWNERSHIP.md §4.2). Owned by S3; no other stream edits it. Every read goes
 * through `src/data/db.ts` (the single client, rule M8). The pure C1–C8 matrix and the discipline set
 * live under `src/lib/risk/**`; this module loads the tenant's stored state and calls the writers.
 */
import { callRpc, callRpcJson, getClient, NOT_CONFIGURED_REASON, type DataResult } from './db';
import { CLASSIFICATIONS, type ClassificationProfile } from '../lib/risk/classification';
import type { Discipline } from '../lib/risk/domains';

export interface OrgClassificationRead {
  classification: string;
  profile: ClassificationProfile | null;
  isIslamic: boolean;
  hasItScope: boolean;
  internalAuditMandatory: boolean;
  internalAuditConditional: boolean;
  icfrMandatory: boolean;
  icfrRigour: string;
  frameworks: string[];
  artifacts: string[];
  regulatorNumbering: string;
  offeredDisciplines: Discipline[];
  version: number;
}

function mapClassification(r: Record<string, unknown>): OrgClassificationRead {
  const code = String(r.classification);
  return {
    classification: code,
    profile: CLASSIFICATIONS.find((c) => c.code === code) ?? null,
    isIslamic: Boolean(r.is_islamic),
    hasItScope: Boolean(r.has_it_scope),
    internalAuditMandatory: Boolean(r.internal_audit_mandatory),
    internalAuditConditional: Boolean(r.internal_audit_conditional),
    icfrMandatory: Boolean(r.icfr_mandatory),
    icfrRigour: String(r.icfr_rigour ?? 'none'),
    frameworks: (r.frameworks as string[]) ?? [],
    artifacts: (r.artifacts as string[]) ?? [],
    regulatorNumbering: String(r.regulator_numbering ?? ''),
    offeredDisciplines: ((r.offered_disciplines as string[]) ?? ['management']) as Discipline[],
    version: Number(r.version ?? 1),
  };
}

/** The organisation's classification, or null when none is set yet. */
export async function readClassification(orgId: string): Promise<OrgClassificationRead | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.from('org_classification').select('*').eq('org_id', orgId).maybeSingle();
  return data ? mapClassification(data as Record<string, unknown>) : null;
}

export interface ObligationRow {
  obligationId: string;
  sourceClause: string;
  subject: string;
}

export async function listClassificationObligations(orgId: string): Promise<ObligationRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('classification_obligations')
    .select('obligation_id,source_clause,subject').eq('org_id', orgId).order('obligation_id');
  return (data ?? []).map((r) => ({
    obligationId: String(r.obligation_id), sourceClause: String(r.source_clause), subject: String(r.subject),
  }));
}

/** Record the organisation's classification. */
export async function setClassification(
  orgId: string, classification: string, isIslamic: boolean, hasItScope: boolean,
): Promise<DataResult> {
  return callRpc('classification_set', {
    p_org: orgId, p_classification: classification, p_is_islamic: isIslamic, p_has_it_scope: hasItScope,
  });
}

// ---------------------------------------------------------------------------
// The standards / frameworks library.
// ---------------------------------------------------------------------------

export interface StandardRow {
  key: string;
  discipline: Discipline;
  kind: string;
  label: string;
  citation: string;
  source: string;
  version: number;
  /** True when this is the org's own override rather than the platform default. */
  overridden: boolean;
}

/**
 * Read the effective standards library for an org: the platform defaults (org_id null), with any of
 * the org's own overrides replacing the default for the same key.
 */
export async function listStandards(orgId: string): Promise<StandardRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('standards_library')
    .select('org_id,key,discipline,kind,label,citation,source,version')
    .order('key');
  const rows = (data ?? []) as Record<string, unknown>[];
  const byKey = new Map<string, StandardRow>();
  for (const r of rows) {
    const key = String(r.key);
    const isOrg = r.org_id != null;
    // The platform row is read first; an org row replaces it.
    if (!byKey.has(key) || isOrg) {
      byKey.set(key, {
        key, discipline: String(r.discipline) as Discipline, kind: String(r.kind),
        label: String(r.label), citation: String(r.citation ?? ''), source: String(r.source ?? ''),
        version: Number(r.version ?? 1), overridden: isOrg,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface StandardsUpdate {
  scope: 'platform' | 'org' | 'all_orgs';
  orgId: string | null;
  key: string;
  discipline: Discipline;
  label: string;
  citation: string;
  source: string;
}

/** Configure one standards-library row for one org, for every org, or the platform default. */
export async function updateStandard(u: StandardsUpdate): Promise<DataResult> {
  const res = (await callRpcJson('standards_update_scope', {
    p_scope: u.scope, p_org: u.orgId, p_key: u.key, p_discipline: u.discipline,
    p_label: u.label, p_citation: u.citation, p_source: u.source,
  })) as { ok: true; data: { scope: string; affected: number } } | { ok: false; reason: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** Derive the framework risks into the org's risk library. Returns how many were added. */
export async function deriveRisks(orgId: string, standardsKey: string | null): Promise<{ ok: boolean; added?: number; reason?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('risk_library_derive', { p_org: orgId, p_standards_key: standardsKey });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, added: Number(data ?? 0) };
}

export interface DerivedRiskRow {
  id: string;
  code: string;
  name: string;
  discipline: string;
  source: string;
  derivedFrom: string;
}

export async function listDerivedRisks(orgId: string): Promise<DerivedRiskRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('risks_library')
    .select('id,code,name,discipline,source,derived_from').eq('org_id', orgId).not('derived_from', 'is', null);
  return (data ?? []).map((r) => ({
    id: String(r.id), code: String(r.code ?? ''), name: String(r.name),
    discipline: String(r.discipline ?? ''), source: String(r.source ?? ''), derivedFrom: String(r.derived_from ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// D14 — the auto-derived factors, the score write and the override.
// ---------------------------------------------------------------------------

export interface RiskScoreRow {
  riskId: string;
  score: number;
  method: string;
  factorValues: Record<string, number>;
  autoValues: unknown[];
  overrides: unknown[];
}

/** Read the stored score (and its auto values and overrides) for one cycle/entity/risk. */
export async function readRiskScore(
  orgId: string, cycleId: string, entityId: string, riskId: string,
): Promise<RiskScoreRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data } = await sb.from('sira_scores')
    .select('risk_id,score,method,factor_values,auto_values,overrides')
    .eq('org_id', orgId).eq('cycle_id', cycleId).eq('entity_id', entityId).eq('risk_id', riskId).maybeSingle();
  if (!data) return null;
  return {
    riskId: String(data.risk_id), score: Number(data.score), method: String(data.method ?? ''),
    factorValues: (data.factor_values as Record<string, number>) ?? {},
    autoValues: (data.auto_values as unknown[]) ?? [],
    overrides: (data.overrides as unknown[]) ?? [],
  };
}

/** Write the auto-derived proposals for one cycle/entity/risk; the score is recomputed and normalised. */
export async function writeRiskFactors(
  orgId: string, cycleId: string, entityId: string, riskId: string,
  autoValues: unknown[], overrides: unknown[],
): Promise<{ ok: boolean; score?: number; reason?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED_REASON };
  const { data, error } = await sb.rpc('risk_factor_write', {
    p_org: orgId, p_cycle: cycleId, p_entity: entityId, p_risk: riskId,
    p_auto_values: autoValues, p_overrides: overrides,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, score: Number(data ?? 0) };
}

export async function setRiskOverride(
  orgId: string, cycleId: string, entityId: string, riskId: string,
  factorKey: string, overrideValue: number, reason: string,
): Promise<DataResult> {
  return callRpc('risk_override_set', {
    p_org: orgId, p_cycle: cycleId, p_entity: entityId, p_risk: riskId,
    p_factor_key: factorKey, p_override_value: overrideValue, p_reason: reason,
  });
}

export async function revertRiskOverride(
  orgId: string, cycleId: string, entityId: string, riskId: string, factorKey: string,
): Promise<DataResult> {
  return callRpc('risk_override_revert', {
    p_org: orgId, p_cycle: cycleId, p_entity: entityId, p_risk: riskId, p_factor_key: factorKey,
  });
}

export interface RiskLibraryRow {
  id: string;
  code: string;
  name: string;
  discipline: string;
  source: string;
  riskType: string;
}

/** The organisation's risk library (the D14 universal/org/discipline rows). */
export async function listRiskLibrary(orgId: string): Promise<RiskLibraryRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('risks_library')
    .select('id,code,name,discipline,source,risk_type').eq('org_id', orgId).order('name');
  return (data ?? []).map((r) => ({
    id: String(r.id), code: String(r.code ?? ''), name: String(r.name),
    discipline: String(r.discipline ?? ''), source: String(r.source ?? ''), riskType: String(r.risk_type ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// D15 — the ERM theme map, the KRIs and the plan-change proposals.
// ---------------------------------------------------------------------------

export interface ErmThemeRow {
  theme: string;
  entityId: string | null;
  isTopRisk: boolean;
}

export async function listErmThemes(orgId: string): Promise<ErmThemeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('erm_theme_map').select('theme,entity_id,is_top_risk').eq('org_id', orgId);
  return (data ?? []).map((r) => ({
    theme: String(r.theme), entityId: r.entity_id == null ? null : String(r.entity_id), isTopRisk: Boolean(r.is_top_risk),
  }));
}

export interface KriRow {
  kriId: string;
  theme: string;
  value: number | null;
  tolerance: number | null;
}

export async function listKris(orgId: string): Promise<KriRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('erm_kri').select('kri_id,theme,value,tolerance').eq('org_id', orgId);
  return (data ?? []).map((r) => ({
    kriId: String(r.kri_id), theme: String(r.theme),
    value: r.value == null ? null : Number(r.value), tolerance: r.tolerance == null ? null : Number(r.tolerance),
  }));
}

export interface PlanChangeRow {
  id: string;
  triggerKind: string;
  action: string;
  rationale: string;
  status: string;
}

export async function listPlanChanges(orgId: string): Promise<PlanChangeRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('plan_change_proposals')
    .select('id,trigger_kind,action,rationale,status').eq('org_id', orgId).order('created_at', { ascending: false });
  return (data ?? []).map((r) => ({
    id: String(r.id), triggerKind: String(r.trigger_kind), action: String(r.action),
    rationale: String(r.rationale), status: String(r.status),
  }));
}

export async function setErmTheme(
  orgId: string, theme: string, entityId: string | null, isTopRisk: boolean,
): Promise<DataResult> {
  return callRpc('erm_theme_set', { p_org: orgId, p_theme: theme, p_entity: entityId, p_is_top_risk: isTopRisk });
}

export async function setKriValue(
  orgId: string, kriId: string, theme: string, value: number | null, tolerance: number | null,
): Promise<DataResult> {
  return callRpc('kri_value_set', {
    p_org: orgId, p_kri_id: kriId, p_theme: theme, p_value: value, p_tolerance: tolerance,
  });
}

export async function proposePlanChange(
  orgId: string, triggerKind: string, entityId: string | null, action: string, rationale: string,
): Promise<DataResult> {
  return callRpc('plan_change_propose', {
    p_org: orgId, p_trigger_kind: triggerKind, p_entity: entityId, p_action: action, p_rationale: rationale,
  });
}

export interface CycleRow {
  id: string;
  universeId: string;
  year: number;
  status: string;
}

/** The organisation's SIRA cycles, for the auto-compute write path. */
export async function listCycles(orgId: string): Promise<CycleRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data } = await sb.from('sira_cycles').select('id,universe_id,year,status').eq('org_id', orgId).order('year', { ascending: false });
  return (data ?? []).map((r) => ({
    id: String(r.id), universeId: String(r.universe_id), year: Number(r.year), status: String(r.status),
  }));
}
