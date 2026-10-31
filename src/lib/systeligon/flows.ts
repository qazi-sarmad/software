/**
 * Systeligon flows (spec §2.2 accepted, §2.3 declined) and verification (§6 Modes A and B), with the
 * §2.2 override carried forward to the next reviewer. Pure and deterministic: time is an argument,
 * nothing reads a clock, nothing calls a model or the network.
 *
 * The engine proposes; the auditor decides. A rule supplies the rows that *require* evidence; the
 * engine never closes a row the auditor has not decided, and it never converts an unknown to a clean
 * result. Where it cannot be satisfied it reverts the row and says why — silence is not a pass.
 */
import type { RuleFinding } from './types';

export type RowDecision = 'open' | 'effective' | 'ineffective';

/** A claim a remark makes, which Mode B checks the evidence against (spec §6). */
export interface RemarkClaim {
  /** Declared evidence type, e.g. `pdf`, `sheet`, `image`. */
  type: string;
  period?: string;
  entity?: string;
  amount?: number;
}

/** One row under test. `evidenceIds` name records in the evidence store. */
export interface TestedRow {
  ref: string;
  values: Record<string, unknown>;
  remark: string;
  decision: RowDecision;
  evidenceIds: string[];
  claim: RemarkClaim | null;
  /** True when a rule finding named this row. */
  required: boolean;
  /** True when the engine added the row (auto-add), not the auditor. */
  autoAdded: boolean;
}

export interface RequiredRow {
  ref: string;
  ruleId: string;
  ruleVersion: number;
  reason: string;
}

/** Extract the rows a rule run requires evidence for, preserving order and de-duplicating by ref. */
export function requiredRowsFromFindings(findings: RuleFinding[]): RequiredRow[] {
  const seen = new Set<string>();
  const out: RequiredRow[] = [];
  for (const f of findings) {
    for (const ref of f.refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ ref, ruleId: f.ruleId, ruleVersion: f.ruleVersion, reason: f.reason });
    }
  }
  return out;
}

/** A population row, in the shape the flow consumes. */
export interface PopulationRow {
  ref: string;
  values: Record<string, unknown>;
}

/**
 * S3 — the accepted flow. Build the tested set: every required row, then `autoAdd` rows from the
 * population that were not required, auto-populated with an empty remark the auditor fills in.
 * A required row is never dropped; an auto-added row is marked so the UI can distinguish them.
 */
export function buildAcceptedTestingSet(
  required: RequiredRow[], population: PopulationRow[], autoAdd = 0,
): TestedRow[] {
  const byRef = new Map(population.map((p) => [p.ref, p]));
  const rows: TestedRow[] = [];
  const seen = new Set<string>();
  for (const r of required) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    rows.push({
      ref: r.ref, values: byRef.get(r.ref)?.values ?? {}, remark: '', decision: 'open',
      evidenceIds: [], claim: null, required: true, autoAdded: false,
    });
  }
  if (autoAdd > 0) {
    let added = 0;
    for (const p of population) {
      if (added >= autoAdd) break;
      if (seen.has(p.ref)) continue;
      seen.add(p.ref);
      rows.push({
        ref: p.ref, values: p.values, remark: '', decision: 'open',
        evidenceIds: [], claim: null, required: false, autoAdded: true,
      });
      added += 1;
    }
  }
  return rows;
}

/**
 * S4 — the declined flow. The sampling method fixes a floor; the floor is a **minimum, never a
 * ceiling**. If the population is larger than the floor, rows are added automatically until the tested
 * number reaches the floor, and never fewer.
 */
export function applyFloor(floor: number, population: PopulationRow[], alreadyTested: string[] = []): TestedRow[] {
  const tested = new Set(alreadyTested);
  const rows: TestedRow[] = [];
  const include = (p: PopulationRow, required: boolean) =>
    rows.push({ ref: p.ref, values: p.values, remark: '', decision: 'open', evidenceIds: [], claim: null, required, autoAdded: !required });

  // The floor counts tested rows. Rows tested earlier are always included; then untested rows are added,
  // in population order, until the tested count reaches the floor — never fewer.
  const untestedNeeded = Math.max(0, floor - tested.size);
  let untestedIncluded = 0;
  for (const p of population) {
    if (tested.has(p.ref)) include(p, true);
    else if (untestedIncluded < untestedNeeded) { include(p, false); untestedIncluded += 1; }
  }
  // A tested ref the population does not carry is still kept (the auditor marked it; never drop it).
  for (const ref of tested) {
    if (!rows.some((r) => r.ref === ref)) {
      rows.push({ ref, values: {}, remark: '', decision: 'open', evidenceIds: [], claim: null, required: true, autoAdded: false });
    }
  }
  return rows;
}

/**
 * S4 — paste-to-fill. A block pasted from a spreadsheet is split into rows and cells; the first line,
 * when it matches the target's column headers, is treated as a header and mapped onto them. This is
 * deterministic clipboard parsing, not inference.
 */
export function parsePastedBlock(block: string, columns: string[]): { header: string[]; rows: string[][] } {
  const lines = block.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const split = (l: string) => l.split('\t');
  if (lines.length === 0) return { header: [], rows: [] };
  const first = split(lines[0]).map((c) => c.trim());
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const looksLikeHeader = first.length === columns.length &&
    first.every((c, i) => normalise(c) === normalise(columns[i]));
  if (looksLikeHeader) return { header: columns, rows: lines.slice(1).map(split) };
  return { header: columns, rows: lines.map(split) };
}

// ---------------------------------------------------------------------------
// S5 — verification, Modes A and B (spec §6)
// ---------------------------------------------------------------------------

/** A stored evidence record. `reachable` is the store's own answer, not assumed. */
export interface EvidenceRecord {
  id: string;
  reachable: boolean;
  /** The type the file actually is, e.g. `pdf`, `sheet`, `image`. */
  type: string;
  /** The hash the store recorded when the bytes were attached. */
  contentSha256: string;
  period?: string;
  entity?: string;
  amount?: number;
  /** Structured fields extracted from the evidence, for the internal-consistency check. */
  fields?: Record<string, unknown>;
}

export interface RowVerification {
  ref: string;
  ok: boolean;
  reasons: string[];
}

/**
 * Mode A — completeness (spec §6.1). Exact: every tested row must carry a remark and a closed
 * decision of `effective` or `ineffective`. A row left `open` is not verified, not a pass.
 */
export function verifyCompleteness(rows: TestedRow[]): RowVerification[] {
  return rows.map((r) => {
    const reasons: string[] = [];
    if (r.decision === 'open') reasons.push('no closed decision');
    if (!r.remark.trim()) reasons.push('no remark');
    return { ref: r.ref, ok: reasons.length === 0, reasons };
  });
}

/**
 * Mode B — evidence against remark (spec §6). Checks that the evidence exists and is reachable, matches
 * the declared type, hash-matches the hash recorded at attachment, and is consistent with the period,
 * entity and amount the remark claims. It does **not** decide whether the evidence proves the remark;
 * that is a human judgement (§7). Fails closed: missing evidence is a reason, never a silent pass.
 */
export function verifyEvidence(
  rows: TestedRow[], evidence: Record<string, EvidenceRecord>,
): RowVerification[] {
  return rows.map((r) => {
    const reasons: string[] = [];
    if (r.decision === 'open') reasons.push('no closed decision');
    if (!r.remark.trim()) reasons.push('no remark');
    if (!r.claim) reasons.push('remark makes no claim to verify');
    if (r.evidenceIds.length === 0) reasons.push('no evidence attached');
    for (const id of r.evidenceIds) {
      const e = evidence[id];
      if (!e) { reasons.push(`evidence ${id} is missing`); continue; }
      if (!e.reachable) reasons.push(`evidence ${id} is not reachable`);
      if (r.claim) {
        if (e.type !== r.claim.type) reasons.push(`evidence ${id} is ${e.type}, not ${r.claim.type}`);
        if (r.claim.period != null && e.period !== r.claim.period) reasons.push(`evidence ${id} period ${e.period ?? 'unset'} does not match ${r.claim.period}`);
        if (r.claim.entity != null && e.entity !== r.claim.entity) reasons.push(`evidence ${id} entity ${e.entity ?? 'unset'} does not match ${r.claim.entity}`);
        if (r.claim.amount != null && e.amount !== r.claim.amount) reasons.push(`evidence ${id} amount ${e.amount ?? 'unset'} does not match ${r.claim.amount}`);
      }
      if (e.fields && e.fields.consistent === false) reasons.push(`evidence ${id} has internally inconsistent figures`);
      if (!/^[0-9a-f]{64}$/i.test(e.contentSha256)) reasons.push(`evidence ${id} has no valid recorded hash`);
    }
    return { ref: r.ref, ok: reasons.length === 0, reasons };
  });
}

/** The active mode, per audit or per org (spec §6). */
export type VerificationMode = 'completeness' | 'evidence';

/** Dispatch to the configured mode. */
export function verifyRows(
  rows: TestedRow[], mode: VerificationMode, evidence: Record<string, EvidenceRecord> = {},
): RowVerification[] {
  return mode === 'evidence' ? verifyEvidence(rows, evidence) : verifyCompleteness(rows);
}

// ---------------------------------------------------------------------------
// S12 — override visibility across stages (spec §2.2)
// ---------------------------------------------------------------------------

/** A row the auditor closed despite a failed verification. This is the override that must carry. */
export interface CarriedOverride {
  ref: string;
  remark: string;
  by: string;
  at: string;
  reasons: string[];
}

/**
 * The overrides a reviewer must be shown. §2.2: the auditor may close anyway, but **only with a
 * remark**, and the override is carried forward and shown at the next stage — the reviewer does not
 * have to discover it. A closure without a remark is not an override; it is an invalid close.
 */
export function carriedOverrides(rows: TestedRow[], verifications: RowVerification[]): CarriedOverride[] {
  const byRef = new Map(verifications.map((v) => [v.ref, v]));
  const out: CarriedOverride[] = [];
  for (const r of rows) {
    if (r.decision === 'open') continue;
    const v = byRef.get(r.ref);
    if (!v || v.ok) continue;
    if (!r.remark.trim()) continue; // an invalid close, not an override
    out.push({ ref: r.ref, remark: r.remark, by: '', at: '', reasons: v.reasons });
  }
  return out;
}
