/**
 * Report graph data module (WRITE-1, spec §15.6; SCALE-TASKS 2.6).
 *
 * The evidence-bound claim graph is committed to the database, which recomputes every claim hash and
 * the Merkle root before it writes (migration 0103), so the committed root is real tenant data that
 * `verify_report_root` can prove. This module loads the records an engagement actually holds, derives
 * the graph through the pure engine (`src/lib/writing/derive.ts`) and calls the writer. Components
 * never import the Supabase client.
 */
import { callRpc, getClient, type DataResult } from './db';
import { deriveEngagementGraph, type ReportRecordSet } from '../lib/writing/derive';
import { claimCanonical, claimHash, graphHashes } from '../lib/writing/graph';
import { findingsToClaims } from '../lib/systeligon/provenance';
import { ENGINE_VERSION } from '../lib/writing/fixtures';
import { DEFAULT_REGISTER } from '../lib/writing/registers';
import type { Claim, EngineVersion, Locale, Register } from '../lib/writing/types';
import type { RuleFinding } from '../lib/systeligon/types';

export interface ReportGraphRow {
  id: string;
  modelId: string;
  formality: number;
  tone: number;
  voice: string;
  locale: string;
  graphRoot: string;
  renderHash: string;
  engineVersion: string;
  templateVersion: string;
  phraseLibraryVersion: string;
  fixedTimestamp: string;
  claimCount: number;
  ledgerSeq: number | null;
}

export interface ReportGraphClaimRow {
  claimId: string;
  sectionId: string;
  position: number;
  kind: string;
  claimLevel: string;
  phraseId: string | null;
  phraseVersion: number | null;
  claimHash: string;
}

export interface ReportGraphView {
  graphs: ReportGraphRow[];
  claims: ReportGraphClaimRow[];
}

/** The records the report is derived from: the engagement's findings, testing and CAPs. */
export async function loadReportRecordSet(engagementId: string): Promise<ReportRecordSet | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data: eng, error: engErr } = await sb
    .from('engagements')
    .select('id, entity_id')
    .eq('id', engagementId)
    .maybeSingle();
  if (engErr) throw new Error(engErr.message);
  if (!eng) return null;

  const [findingsRes, wpsRes, capsRes] = await Promise.all([
    sb.from('findings').select('id, severity').eq('entity_id', eng.entity_id as string),
    sb.from('workpapers').select('id, status').eq('engagement_id', engagementId),
    sb.from('caps').select('id, status').eq('engagement_id', engagementId),
  ]);
  if (findingsRes.error) throw new Error(findingsRes.error.message);
  if (wpsRes.error) throw new Error(wpsRes.error.message);
  if (capsRes.error) throw new Error(capsRes.error.message);

  const workpaperIds = (wpsRes.data ?? []).map((w) => w.id as string);
  let rows: Array<{ workpaper_id: string; result: string | null }> = [];
  if (workpaperIds.length > 0) {
    const { data, error } = await sb
      .from('workpaper_rows')
      .select('workpaper_id, result')
      .in('workpaper_id', workpaperIds);
    if (error) throw new Error(error.message);
    rows = (data ?? []) as Array<{ workpaper_id: string; result: string | null }>;
  }

  const exceptionRows = rows.filter((r) => r.result === 'cross' || r.result === 'unverifiable');
  const exceptionWorkpapers = new Set(exceptionRows.map((r) => r.workpaper_id));

  return {
    engagementId,
    modelId: 'M1',
    scopeStart: null,
    scopeEnd: null,
    findings: (findingsRes.data ?? []).map((f) => ({
      id: f.id as string, severity: (f.severity as string | null) ?? null,
    })),
    controlsTested: workpaperIds.length,
    controlsWithExceptions: exceptionWorkpapers.size,
    itemsTested: rows.length,
    sampleExceptions: exceptionRows.length,
    exceptionValueMinor: 0,
    caps: (capsRes.data ?? []).map((c) => ({ id: c.id as string, status: c.status as string })),
  };
}

interface DetailedClaim { claim: Claim; canonical: string; claimHash: string; }

/** The claim facts the writer verifies, in graph order. */
function claimsPayload(claims: DetailedClaim[]) {
  return claims.map((c, i) => ({
    claim_id: c.claim.id,
    section_id: c.claim.sectionId,
    position: i + 1,
    kind: c.claim.kind,
    claim_level: c.claim.claimLevel,
    slots: c.claim.slots,
    phrase_id: c.claim.phraseId,
    phrase_version: c.claim.phraseVersion,
    rule_id: c.claim.ruleId,
    rule_version: c.claim.ruleVersion,
    references: c.claim.references,
    figures: c.claim.figures,
    approval: c.claim.approval,
    auditor_text: c.claim.auditorText ?? null,
    canonical: c.canonical,
    claim_hash: c.claimHash,
  }));
}

/**
 * S13 (§9.4, F39): the rule findings recorded against an engagement, as the report must cite them.
 * They live in the ledger's rule-evaluation payloads, so the report has its provenance available
 * without a second copy that could drift. Unconfigured, or no evaluations, returns an empty list.
 */
export async function loadSysteligonFindings(engagementId: string): Promise<RuleFinding[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('ledger_entries')
    .select('payload')
    .eq('action', 'rule_finding')
    .eq('payload->>engagement_id', engagementId)
    .order('seq', { ascending: true });
  if (error) return [];
  return (data ?? []).map((r) => (r.payload as { finding?: RuleFinding }).finding)
    .filter((f): f is RuleFinding => !!f && typeof f.ruleId === 'string');
}

/** Detail a finding-derived claim the same way the engine details a plan-built one. */
async function detail(claim: Claim): Promise<DetailedClaim> {
  return { claim, canonical: claimCanonical(claim), claimHash: await claimHash(claim) };
}

export interface CommitReportGraphInput {
  reportVersionId: string;
  engagementId: string;
  register?: Register;
  locale?: Locale;
  versions?: EngineVersion;
  fixedTimestamp?: string;
}

/**
 * Derive and commit the report graph for a report version. The fixed timestamp is the report's
 * frozen-at or created-at value, or the caller's; a pure function never reads the clock, so the
 * value is passed in rather than taken here.
 */
export async function commitReportGraph(input: CommitReportGraphInput): Promise<DataResult> {
  const records = await loadReportRecordSet(input.engagementId);
  if (!records) return { ok: false, reason: 'The engagement could not be loaded.' };
  const register = input.register ?? DEFAULT_REGISTER;
  const locale = input.locale ?? 'en-GB';
  const versions = input.versions ?? ENGINE_VERSION;
  const derived = await deriveEngagementGraph(records, register, locale, versions);

  // S13 (§9.4): the report cites the Systeligon findings with their rule provenance intact. They are
  // appended to the plan-built claims, then the whole set is re-rooted, so the committed root covers
  // the findings' evidence too and `report_graph_commit` re-derives exactly what is committed here.
  const findings = await loadSysteligonFindings(input.engagementId);
  const findingClaims = findings.length ? (await findingsToClaims(findings)).claims : [];
  const detailed: DetailedClaim[] = [
    ...derived.claims,
    ...(await Promise.all(findingClaims.map(detail))),
  ];
  const allClaims = detailed.map((d) => d.claim);
  const hashes = await graphHashes(allClaims);

  return callRpc('report_graph_commit', {
    p_report_version_id: input.reportVersionId,
    p_model_id: derived.graph.modelId,
    p_formality: register.formality,
    p_tone: register.tone,
    p_voice: register.voice,
    p_locale: locale,
    p_engine_version: versions.engine,
    p_template_version: versions.template,
    p_phrase_library_version: versions.phraseLibrary,
    p_fixed_timestamp: input.fixedTimestamp ?? new Date().toISOString(),
    p_graph_root: hashes.graphRoot,
    p_render_hash: hashes.graphRoot,
    p_claims: claimsPayload(detailed),
  });
}

/** The committed graph and claims for one report version (the screen's drilldown). */
export async function getReportGraph(reportVersionId: string): Promise<ReportGraphView> {
  const sb = getClient();
  if (!sb) return { graphs: [], claims: [] };
  const { data, error } = await sb.rpc('report_graph_get', { p_report_version_id: reportVersionId });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { graphs?: unknown[]; claims?: unknown[] };
  return {
    graphs: ((d.graphs ?? []) as Array<Record<string, unknown>>).map((g) => ({
      id: g.id as string,
      modelId: g.model_id as string,
      formality: g.formality as number,
      tone: g.tone as number,
      voice: g.voice as string,
      locale: g.locale as string,
      graphRoot: g.graph_root as string,
      renderHash: g.render_hash as string,
      engineVersion: g.engine_version as string,
      templateVersion: g.template_version as string,
      phraseLibraryVersion: g.phrase_library_version as string,
      fixedTimestamp: g.fixed_timestamp as string,
      claimCount: (g.claim_count as number | null) ?? 0,
      ledgerSeq: (g.ledger_seq as number | null) ?? null,
    })),
    claims: ((d.claims ?? []) as Array<Record<string, unknown>>).map((c) => ({
      claimId: c.claim_id as string,
      sectionId: c.section_id as string,
      position: (c.position as number | null) ?? 0,
      kind: c.kind as string,
      claimLevel: c.claim_level as string,
      phraseId: (c.phrase_id as string | null) ?? null,
      phraseVersion: (c.phrase_version as number | null) ?? null,
      claimHash: c.claim_hash as string,
    })),
  };
}
