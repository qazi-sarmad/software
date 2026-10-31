/**
 * Lifecycle configuration data layer (stream S6 — the R3 configuration-honesty rows).
 *
 * F30: the configurable engagement stage machine. The machine is stored per organisation in
 * `org_stage_machine` (migration 0179) and read back through `stage_machine_get()`. The three
 * legacy stages are the default; a tenant may rename their labels and add stages, but each stage
 * anchors to one of the three built-in gates, so the ethics check, the testing lock and the
 * conclusion-readiness rule keep firing.
 *
 * Every call goes through `callRpcJson`, so a refusal the database returns as `{ok:false, reason}`
 * is surfaced as a failure rather than silently accepted.
 */
import { callRpcJson } from './db';

/** The three built-in gates a stage can anchor to. */
export const STAGE_ANCHORS = ['planning', 'testing', 'conclusion'] as const;
export type StageAnchor = (typeof STAGE_ANCHORS)[number];

export interface StageRow {
  key: string;
  label: string;
  position: number;
  anchor: StageAnchor;
}

export interface StageMachine {
  /** True when the org has configured its own machine rather than using the default. */
  custom: boolean;
  stages: StageRow[];
  /** How many live engagements sit on each stage, so a tenant can see why a stage matters. */
  inUse: { stage: string; count: number }[];
}

type RawStage = { key?: unknown; label?: unknown; position?: unknown; anchor?: unknown };

function toStage(r: RawStage): StageRow {
  const anchor = String(r.anchor ?? 'planning');
  return {
    key: String(r.key ?? ''),
    label: String(r.label ?? ''),
    position: Number(r.position ?? 0),
    anchor: (STAGE_ANCHORS as readonly string[]).includes(anchor) ? (anchor as StageAnchor) : 'planning',
  };
}

/** Read the effective stage machine for the caller's organisation. */
export async function getStageMachine(): Promise<StageMachine> {
  type Payload = { custom?: unknown; stages?: unknown; in_use?: unknown };
  const res = (await callRpcJson('stage_machine_get', {})) as
    { ok: true; data: Payload } | { ok: false; reason: string };
  if (!res.ok) throw new Error(res.reason);
  const stages = Array.isArray(res.data.stages) ? (res.data.stages as RawStage[]).map(toStage) : [];
  const inUse = Array.isArray(res.data.in_use)
    ? (res.data.in_use as { stage?: unknown; count?: unknown }[]).map((r) => ({
        stage: String(r.stage ?? ''),
        count: Number(r.count ?? 0),
      }))
    : [];
  return { custom: res.data.custom === true, stages, inUse };
}

/**
 * Save a whole machine. A machine is an ordered set, so this replaces it in one call; the database
 * refuses a machine that drops an anchor, duplicates a key, or orders the anchors wrongly.
 */
export async function saveStageMachine(stages: StageRow[]) {
  return (await callRpcJson('admin_save_stage_machine', {
    p_stages: stages.map((s) => ({ key: s.key, label: s.label, anchor: s.anchor })),
  })) as { ok: true; data: { stages?: unknown } } | { ok: false; reason: string };
}

/** Reset the organisation to the three default stages. */
export async function resetStageMachine() {
  return (await callRpcJson('admin_reset_stage_machine', {})) as
    { ok: true; data: Record<string, unknown> } | { ok: false; reason: string };
}

/** The three defaults, mirrored for the screen so it can show what a reset restores. */
export function defaultStages(): StageRow[] {
  return [
    { key: 'planning', label: 'Planning', position: 1, anchor: 'planning' },
    { key: 'testing', label: 'Testing', position: 2, anchor: 'testing' },
    { key: 'conclusion', label: 'Conclusion', position: 3, anchor: 'conclusion' },
  ];
}

/**
 * The next stage after `current` on a given machine, or undefined when `current` is the last stage
 * or is not on the machine. Pure: no clock, no client — the screen supplies the machine it read.
 */
export function nextStage(stages: StageRow[], current: string): StageRow | undefined {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const i = ordered.findIndex((s) => s.key === current);
  return i >= 0 && i + 1 < ordered.length ? ordered[i + 1] : undefined;
}
