/**
 * W1: the claim graph, its facts, and its hashes.
 *
 * The graph root covers the FACTS: claims, typed slots, references and figure lineage. It is
 * identical for every formality, tone, voice and locale of the same report. Changing evidence
 * changes the claim hash, the section hash and the root.
 *
 * The render hash covers the WORDS: the selected phrase variant, the register, the locale and the
 * rendered text. Changing only register or locale changes the render hash and never the root.
 *
 * `text = render(graph, model, formality, tone, voice, locale, engine_version, template_version,
 * phrase_library_version, fixed_timestamp)`. Nothing else is an input.
 */

import {
  CanonicalValue, canonicalise, hashCanonical, hashParts, decimalToString, Decimal, utcInstant,
} from './canonical';
import { buildMerkleTree, merkleProof, MerkleProof, MerkleTree, verifyInclusion } from './merkle';
import type { Claim, ClaimGraph, Locale, Register, Reference } from './types';

/** References are sorted by (type, id) so the order they were gathered in cannot change the hash. */
export function sortReferences(refs: Reference[]): Reference[] {
  return [...refs].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function slotValue(v: unknown): CanonicalValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    // Slots carry numbers only through a fixed-scale decimal; a raw float is a mistake.
    if (!Number.isInteger(v)) return { $dec: v.toString() } as unknown as CanonicalValue;
    return v;
  }
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map((x) => String(x));
  // A money or number slot carries a fixed-scale Decimal; hash it as its exact string form.
  if (typeof v === 'object' && 'scale' in (v as object) && 'units' in (v as object)) {
    return { $dec: decimalToString(v as Decimal) } as unknown as CanonicalValue;
  }
  return String(v);
}

/**
 * The canonical facts of one claim. This is the leaf body: no words, no register, no locale. Two
 * claims that differ only in register produce the same leaf.
 */
export function claimFacts(claim: Claim): CanonicalValue {
  const facts: { [k: string]: CanonicalValue } = {
    id: claim.id,
    kind: claim.kind,
    claimLevel: claim.claimLevel,
    modelId: claim.modelId,
    sectionId: claim.sectionId,
    phraseId: claim.phraseId,
    phraseVersion: claim.phraseVersion,
    ruleId: claim.ruleId,
    ruleVersion: claim.ruleVersion,
    slots: claim.slots
      .map((s) => ({ name: s.name, kind: s.kind, value: slotValue(s.value) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    references: sortReferences(claim.references).map((r) => ({
      type: r.type, id: r.id, contentHash: r.contentHash,
    })),
    figures: claim.figures
      .map((f) => ({
        figureId: f.figureId,
        figureVersion: f.figureVersion,
        parameters: f.parameters,
        result: f.result,
      }))
      .sort((a, b) => (a.figureId < b.figureId ? -1 : a.figureId > b.figureId ? 1 : a.figureVersion - b.figureVersion)),
  };
  if (claim.approval) {
    facts.approval = {
      observationId: claim.approval.observationId,
      approvedBy: claim.approval.approvedBy,
      approvedAt: utcInstant(claim.approval.approvedAt),
      observationVersion: claim.approval.observationVersion,
      contentHash: claim.approval.contentHash,
    };
  }
  if (claim.kind === 'auditor') {
    // The auditor's own words are facts of their claim: they are not re-worded by the engine.
    facts.auditorText = claim.auditorText ?? '';
    facts.auditorAuthor = claim.auditorAuthor ?? '';
    facts.auditorAt = claim.auditorAt ? utcInstant(claim.auditorAt) : '';
  }
  return facts;
}

/** The canonical text of one claim's facts. */
export function claimCanonical(claim: Claim): string {
  return canonicalise(claimFacts(claim));
}

/** The hash of one claim's facts. */
export function claimHash(claim: Claim): Promise<string> {
  return hashCanonical(claimFacts(claim));
}

/** The hash of a section: over the ordered claim hashes it contains. */
export async function sectionHash(claims: Claim[]): Promise<string> {
  const hashes = await Promise.all(claims.map(claimHash));
  return hashParts(['section', ...hashes]);
}

export interface GraphHashes {
  graphRoot: string;
  claimHashes: string[];
  sectionHashes: Record<string, string>;
  tree: MerkleTree;
}

/**
 * The graph root over the ordered claims, plus each claim hash and each section hash. Claims are
 * hashed in the order given (the document plan's order), so a reordering changes the root.
 */
export async function graphHashes(claims: Claim[]): Promise<GraphHashes> {
  const leaves = claims.map(claimCanonical);
  const tree = await buildMerkleTree(leaves);
  const claimHashes = tree.leafHashes;
  const bySection = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = bySection.get(claim.sectionId) ?? [];
    list.push(claim);
    bySection.set(claim.sectionId, list);
  }
  const sectionHashes: Record<string, string> = {};
  for (const [sectionId, list] of bySection) {
    sectionHashes[sectionId] = await sectionHash(list);
  }
  return { graphRoot: tree.root, claimHashes, sectionHashes, tree };
}

/** The inclusion proof for one claim in the graph. */
export function claimProof(hashes: GraphHashes, claimIndex: number): MerkleProof {
  return merkleProof(hashes.tree, claimIndex);
}

/** Verify a claim's inclusion against the graph root. Used by the offline verifier (W10.2). */
export function verifyClaim(proof: MerkleProof, claim: Claim, root: string): Promise<boolean> {
  return verifyInclusion(proof, claimCanonical(claim), root);
}

/**
 * The render hash: the exact words, the language and the register. Built from the graph root plus
 * the selected phrase variant and the rendered text of each claim. Changing a word changes it;
 * changing a fact changes it too, because the graph root is an input.
 */
export async function renderHash(input: {
  graphRoot: string;
  register: Register;
  locale: Locale;
  versions: { engine: string; template: string; phraseLibrary: string };
  rendered: Array<{ claimId: string; phraseId: string; phraseVersion: number; text: string }>;
  fixedTimestamp: string;
}): Promise<string> {
  const body = input.rendered.map((r) =>
    `${r.claimId}\u0001${r.phraseId}\u0001${r.phraseVersion}\u0001${r.text}`);
  return hashParts([
    'render',
    input.graphRoot,
    String(input.register.formality),
    String(input.register.tone),
    input.register.voice,
    input.locale,
    input.versions.engine,
    input.versions.template,
    input.versions.phraseLibrary,
    utcInstant(input.fixedTimestamp),
    ...body,
  ]);
}

/** Re-export for callers that build graphs. */
export { decimalToString };
export type { Decimal, ClaimGraph };
