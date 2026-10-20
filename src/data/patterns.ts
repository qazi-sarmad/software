/**
 * Cross-engagement Patterns data module (F15, S10). Every call goes through a typed function here;
 * components never import the database client (rule M8).
 */
import { getClient } from './db';
import type { PatternFinding, PatternSettings } from '../lib/patterns';

const NOT_CONFIGURED = 'The Patterns module is not configured.';

export const DEFAULT_PATTERN_SETTINGS: PatternSettings = {
  similarityThreshold: 0.40, minClusterSize: 2, yearsBack: 5, severities: [], visibilityRight: 'view_insights',
};

interface RawSettings {
  similarity_threshold: number | string | null;
  min_cluster_size: number | null;
  years_back: number | null;
  severities: unknown;
  visibility_right: string | null;
}

interface RawFinding {
  finding_id: string;
  entity_id: string | null;
  entity_name: string | null;
  year: number | null;
  severity: string | null;
  title: string | null;
  condition_text: string | null;
  risk_text: string | null;
  effect_text: string | null;
  control_tags: string[] | null;
  risk_tags: string[] | null;
  category_tags: string[] | null;
  entity_type: string | null;
}

function toSettings(raw: RawSettings | undefined): PatternSettings {
  if (!raw) return { ...DEFAULT_PATTERN_SETTINGS };
  const sev = Array.isArray(raw.severities) ? (raw.severities as unknown[]).map(String) : [];
  return {
    similarityThreshold: Number(raw.similarity_threshold ?? DEFAULT_PATTERN_SETTINGS.similarityThreshold),
    minClusterSize: Number(raw.min_cluster_size ?? DEFAULT_PATTERN_SETTINGS.minClusterSize),
    yearsBack: Number(raw.years_back ?? DEFAULT_PATTERN_SETTINGS.yearsBack),
    severities: sev,
    visibilityRight: raw.visibility_right ?? DEFAULT_PATTERN_SETTINGS.visibilityRight,
  };
}

function toFinding(raw: RawFinding): PatternFinding {
  return {
    findingId: raw.finding_id,
    entityId: raw.entity_id,
    entityName: raw.entity_name,
    year: raw.year,
    severity: raw.severity,
    title: raw.title ?? 'Untitled finding',
    conditionText: raw.condition_text ?? '',
    riskText: raw.risk_text ?? '',
    effectText: raw.effect_text ?? '',
    controlTags: raw.control_tags ?? [],
    riskTags: raw.risk_tags ?? [],
    categoryTags: raw.category_tags ?? [],
    entityType: raw.entity_type ?? '',
  };
}

/** Read the org's pattern settings (seeding the defaults on the server on first call). */
export async function getPatternSettings(orgId: string): Promise<PatternSettings> {
  const sb = getClient();
  if (!sb || !orgId) return { ...DEFAULT_PATTERN_SETTINGS };
  const { data, error } = await sb.rpc('pattern_settings_get', { p_org: orgId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as RawSettings | undefined;
  return toSettings(raw);
}

/** Save the org's pattern settings. */
export async function savePatternSettings(
  orgId: string,
  fields: Partial<{
    similarityThreshold: number; minClusterSize: number; yearsBack: number;
    severities: string[]; visibilityRight: string;
  }>
): Promise<{ ok: boolean; reason?: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { error } = await sb.rpc('pattern_settings_save', {
    p_org: orgId,
    p_threshold: fields.similarityThreshold ?? null,
    p_min_cluster_size: fields.minClusterSize ?? null,
    p_years_back: fields.yearsBack ?? null,
    p_severities: fields.severities ?? null,
    p_visibility_right: fields.visibilityRight ?? null,
  });
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/** The deterministic finding corpus the clustering reads. */
export async function listPatternFindings(orgId: string): Promise<PatternFinding[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('pattern_findings', { p_org: orgId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawFinding[]).map(toFinding);
}
