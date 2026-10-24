/**
 * Tutorials (F18). The registry is read-only for a viewer; a view (with the "Did this help?"
 * answer) is recorded for the library health screen. Components never import the database client.
 */
import { callRpc, getClient, type DataResult } from './db';

export type TutorialAudience = 'super_admin' | 'org_admin' | 'both';

export interface TutorialStep {
  text: string;
  testid: string | null;
}

export interface TutorialRow {
  key: string;
  audience: TutorialAudience;
  title: string;
  steps: TutorialStep[];
  mediaPath: string | null;
  uiHash: string | null;
  generatedAt: string | null;
}

/** A step may be stored as a plain string (the S12 seed) or as `{ text, testid }` (C4 onward). */
function toStep(raw: unknown): TutorialStep {
  if (typeof raw === 'string') return { text: raw, testid: null };
  const r = (raw ?? {}) as Record<string, unknown>;
  return { text: (r.text as string) ?? '', testid: (r.testid as string | null) ?? null };
}

const NOT_CONFIGURED = 'The tutorials module is not configured.';

export async function listTutorials(): Promise<TutorialRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.rpc('list_tutorials');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    key: r.key as string,
    audience: (r.audience as TutorialAudience) ?? 'both',
    title: (r.title as string) ?? '',
    steps: ((r.steps as unknown[]) ?? []).map(toStep),
    mediaPath: (r.media_path as string | null) ?? null,
    uiHash: (r.ui_hash as string | null) ?? null,
    generatedAt: (r.generated_at as string | null) ?? null,
  }));
}

export function recordTutorialView(key: string, helped: boolean): Promise<DataResult> {
  return callRpc('record_tutorial_view', { p_key: key, p_helped: helped }, NOT_CONFIGURED);
}

/**
 * Registry health: a key is stale when the recorded ui_hash no longer matches the live one, and
 * missing when it has no media file. Drives SA-13.
 */
export function tutorialHealth(
  rows: TutorialRow[], liveHashes: Record<string, string>
): { missing: string[]; stale: string[]; ok: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  const ok: string[] = [];
  for (const r of rows) {
    if (!r.mediaPath) { missing.push(r.key); continue; }
    if (r.uiHash && liveHashes[r.key] && r.uiHash !== liveHashes[r.key]) { stale.push(r.key); continue; }
    ok.push(r.key);
  }
  return { missing, stale, ok };
}
