/**
 * Methodology data module (Phase 4, spec §10.1, §11.3).
 *
 * The only place the methodology library and the test-step panel talk to the database for procedures.
 * A procedure is a versioned, org-owned template of ordered test steps (migration 0110). Reads use the
 * org-scoped RPCs; every write goes through an RPC that requires edit_config and writes a versioned,
 * hash-chained configuration change. With no environment variables every function is inert: reads
 * return empty and writes report that the module is not configured.
 */
import { callRpc, getClient, type DataResult } from './db';

const NOT_CONFIGURED = 'The methodology module is not configured.';

/**
 * The closed set of test-step kinds. It matches the database CHECK in 0110 and the non-population
 * test types the spec names (§27.3: inquiry, observation, document review) plus the population-based
 * reperformance/analytical types. The database refuses anything else, so the screen cannot offer an
 * unrenderable kind.
 */
export const STEP_KINDS = [
  'inquiry', 'observation', 'document_review', 'inspection', 'reperformance', 'recalculation', 'analytical',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_KIND_LABELS: Record<StepKind, string> = {
  inquiry: 'Inquiry',
  observation: 'Observation',
  document_review: 'Document review',
  inspection: 'Inspection',
  reperformance: 'Reperformance',
  recalculation: 'Recalculation',
  analytical: 'Analytical procedure',
};

export interface ProcedureStep {
  stepKey: string;
  label: string;
  kind: StepKind;
  requiresEvidence: boolean;
  ordinal: number;
}

export interface ProcedureTemplate {
  id: string;
  modelId: string;
  version: number;
  title: string;
  description: string;
  steps: ProcedureStep[];
  updatedAt: string | null;
}

function mapStep(raw: Record<string, unknown>): ProcedureStep {
  const kind = String(raw.kind ?? 'inquiry') as StepKind;
  return {
    stepKey: String(raw.step_key ?? ''),
    label: String(raw.label ?? ''),
    kind: (STEP_KINDS as readonly string[]).includes(kind) ? kind : 'inquiry',
    requiresEvidence: Boolean(raw.requires_evidence),
    ordinal: Number(raw.ordinal ?? 0),
  };
}

function mapTemplate(raw: Record<string, unknown>): ProcedureTemplate {
  const steps = ((raw.steps as Record<string, unknown>[]) ?? []).map(mapStep)
    .sort((a, b) => a.ordinal - b.ordinal);
  return {
    id: String(raw.id),
    modelId: String(raw.model_id ?? ''),
    version: Number(raw.version ?? 1),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    steps,
    updatedAt: (raw.updated_at as string) ?? null,
  };
}

async function rpcJson(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** The organisation's current procedure per audit type (0110). */
export async function listProcedureTemplates(): Promise<ProcedureTemplate[]> {
  const r = await rpcJson('procedure_template_list', {});
  if (!Array.isArray(r)) return [];
  return (r as Record<string, unknown>[]).map(mapTemplate);
}

/** One procedure, with its ordered steps (0110). */
export async function getProcedureTemplate(id: string): Promise<ProcedureTemplate | null> {
  const r = await rpcJson('procedure_template_get', { p_template_id: id });
  if (!r || typeof r !== 'object') return null;
  return mapTemplate(r as Record<string, unknown>);
}

/** Create a new version of a procedure with its ordered steps (0110, requires edit_config). */
export function saveProcedureTemplate(
  modelId: string, title: string, description: string, steps: ProcedureStep[]
): Promise<DataResult> {
  return callRpc('procedure_template_save', {
    p_model_id: modelId,
    p_title: title,
    p_description: description,
    p_steps: steps.map((s) => ({
      step_key: s.stepKey, label: s.label, kind: s.kind, requires_evidence: s.requiresEvidence,
    })),
  }, NOT_CONFIGURED);
}

/** Make a procedure version the current one (0110, requires edit_config). */
export function publishProcedureTemplate(templateId: string): Promise<DataResult> {
  return callRpc('procedure_template_publish', { p_template_id: templateId }, NOT_CONFIGURED);
}

export interface WorkpaperStepRow {
  stepId: string;
  label: string;
  kind: StepKind;
  requiresEvidence: boolean;
  completed: boolean;
  ordinal: number;
  fromTemplate: boolean;
}

/** The steps applied to a workpaper, in order (0110). RLS scopes the read to the caller's org. */
export async function listWorkpaperSteps(workpaperId: string): Promise<WorkpaperStepRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('workpaper_step_state')
    .select('step_id, label, kind, requires_evidence, completed, ordinal, template_id')
    .eq('workpaper_id', workpaperId);
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .map((r) => {
      const kind = String(r.kind ?? 'inquiry') as StepKind;
      return {
        stepId: String(r.step_id ?? ''),
        label: String(r.label ?? r.step_id ?? ''),
        kind: (STEP_KINDS as readonly string[]).includes(kind) ? kind : 'inquiry',
        requiresEvidence: Boolean(r.requires_evidence),
        completed: Boolean(r.completed),
        ordinal: Number(r.ordinal ?? 0),
        fromTemplate: r.template_id != null,
      };
    })
    .sort((a, b) => a.ordinal - b.ordinal || a.stepId.localeCompare(b.stepId));
}

/** Snapshot the current procedure for a model onto a workpaper (0110, requires perform_work). */
export function applyTemplateToWorkpaper(workpaperId: string, modelId: string): Promise<DataResult> {
  return callRpc('workpaper_apply_template', {
    p_workpaper_id: workpaperId, p_model_id: modelId,
  }, NOT_CONFIGURED);
}
