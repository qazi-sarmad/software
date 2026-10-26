/**
 * W3.3: the document planner. Rule-based, deterministic. It builds the DocumentPlan from structured
 * data and the model: stable numbering, automatic cross-references by claim id, consistent
 * terminology through a client mapping, and one canonical claim for the same fact wherever it is
 * cited. A reference that no longer resolves blocks the freeze.
 */

import { modelById, modelSections } from './models';
import type { Claim, ClaimGraph, DocumentPlan, EngineVersion, Locale, Register, Section } from './types';

export interface TerminologyMapping {
  /** The client's preferred term, keyed by the engine's canonical term. */
  [canonical: string]: string;
}

export interface PlanInput {
  modelId: string;
  register: Register;
  locale: Locale;
  claims: Claim[];
  versions: EngineVersion;
  /** A client terminology mapping: it renames the displayed term, never the auditor's text. */
  terminology?: TerminologyMapping;
  /** The set of claim ids a cross-reference may point at. */
  resolvableClaimIds?: string[];
}

export interface PlannedReport {
  plan: DocumentPlan;
  /** The claims grouped by section, in plan order, each section's claims in stable order. */
  bySection: Array<{ section: Section; claims: Claim[] }>;
  /** Cross-references that do not resolve. Empty means the freeze may proceed. */
  brokenReferences: string[];
}

/**
 * Build the document plan. The plan's section order comes from the model; the claims are placed in
 * the section the claim names, and a claim whose section is not in the model is a planning error
 * reported by `brokenReferences` (its section id).
 */
export function planReport(input: PlanInput): PlannedReport {
  const model = modelById(input.modelId);
  if (!model) throw new Error(`unknown model: ${input.modelId}`);
  const sections = modelSections(input.modelId);
  const sectionIds = new Set(sections.map((s) => s.id));

  const bySectionMap = new Map<string, Claim[]>();
  for (const section of sections) bySectionMap.set(section.id, []);
  const orphanedSections: string[] = [];
  for (const claim of input.claims) {
    const list = bySectionMap.get(claim.sectionId);
    if (!list) {
      orphanedSections.push(claim.sectionId);
      continue;
    }
    list.push(claim);
  }
  // Stable order within a section: by claim id, so the plan is deterministic.
  for (const list of bySectionMap.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const resolvable = new Set(input.resolvableClaimIds ?? input.claims.map((c) => c.id));
  const brokenReferences: string[] = [...orphanedSections];
  for (const claim of input.claims) {
    for (const xref of claim.crossReferences ?? []) {
      if (!resolvable.has(xref)) brokenReferences.push(`${claim.id} -> ${xref}`);
    }
  }
  brokenReferences.sort();

  return {
    plan: model.plan,
    bySection: sections.map((section) => ({ section, claims: bySectionMap.get(section.id) ?? [] })),
    brokenReferences,
  };
}

/**
 * Apply a client terminology mapping to a displayed heading. The mapping never rewrites auditor
 * text; it only renames a term the client uses differently. A term with no mapping is unchanged.
 */
export function applyTerminology(text: string, mapping: TerminologyMapping | undefined): string {
  if (!mapping) return text;
  let out = text;
  // Longest canonical term first, so "control deficiency" is replaced before "control".
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    out = out.split(key).join(mapping[key]);
  }
  return out;
}

/**
 * The plan's stable numbering: section numbers in plan order, and a claim's number within its
 * section. A finding added or removed renumbers only the sections that must change, because the
 * numbering is derived from the plan order and the claim order within a section.
 */
export function numbering(planned: PlannedReport): Record<string, string> {
  const numbers: Record<string, string> = {};
  planned.bySection.forEach((entry, sectionIndex) => {
    entry.claims.forEach((claim, claimIndex) => {
      numbers[claim.id] = `${sectionIndex + 1}.${claimIndex + 1}`;
    });
  });
  return numbers;
}

/**
 * W3.4: a finding added changes only the sections that must change. We model this as the plan's
 * per-section claim-id lists: two plans differ only where the added claim lands.
 */
export function changedSections(a: PlannedReport, b: PlannedReport): string[] {
  const changed: string[] = [];
  const bMap = new Map(b.bySection.map((e) => [e.section.id, e.claims.map((c) => c.id).join(',')]));
  for (const entry of a.bySection) {
    const before = entry.claims.map((c) => c.id).join(',');
    const after = bMap.get(entry.section.id) ?? '';
    if (before !== after) changed.push(entry.section.id);
  }
  for (const entry of b.bySection) {
    if (!a.bySection.some((e) => e.section.id === entry.section.id)) changed.push(entry.section.id);
  }
  return changed.sort();
}

/** Build a graph from planned claims at a register and locale. */
export function graphFromPlan(planned: PlannedReport, register: Register, locale: Locale,
  versions: EngineVersion): ClaimGraph {
  return {
    modelId: planned.plan.modelId,
    register,
    locale,
    claims: planned.bySection.flatMap((e) => e.claims),
    versions,
  };
}
