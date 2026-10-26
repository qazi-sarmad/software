/**
 * W10: independent verification — the third-party proof.
 *
 * 10.1 The export bundle for a frozen report: claims, edges, phrase versions, register, locale,
 *      figure functions and lineage (source record hashes), observation approvals, the graph root,
 *      the render hash and Merkle proofs.
 * 10.2 A standalone verifier (scripts/verify-report-bundle.mjs) using only Node's standard library
 *      recomputes every claim hash, the Merkle root, every figure's lineage hash and the rendered
 *      text from the bundle.
 *
 * The bundle is plain JSON. Nothing in it is secret: it holds hashes, versions and the released
 * wording, so an external party can check it without access to the tenant.
 */

import { canonicalise, sha256Hex, type CanonicalValue } from './canonical';
import { buildMerkleTree, merkleProof, type MerkleProof } from './merkle';
import { claimCanonical } from './graph';
import type { Claim, EngineVersion, Locale, Register } from './types';
import type { FigureLineage } from './figures';

export const BUNDLE_FORMAT = 'provio.report-bundle';
export const BUNDLE_VERSION = 1;

export interface BundleClaim {
  id: string;
  kind: Claim['kind'];
  claimLevel: Claim['claimLevel'];
  phraseId: string;
  phraseVersion: number;
  /** The canonical facts of the claim, exactly as the engine hashes them. The verifier rehashes it. */
  canonical: string;
  /** SHA-256 of `canonical`. */
  claimHash: string;
  /** The rendered sentence at the bundle's register and locale. */
  text: string;
  /** The approval of the observation the claim derives from, when it has one. */
  approval: Claim['approval'];
}

export interface ReportBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  modelId: string;
  register: Register;
  locale: Locale;
  versions: EngineVersion;
  fixedTimestamp: string;
  /** The Merkle root over the ordered claim canonical texts. */
  graphRoot: string;
  renderHash: string;
  claims: BundleClaim[];
  /** One inclusion proof per claim, against the graph root. */
  proofs: Array<{ claimId: string; proof: MerkleProof }>;
  /** The lineage for every figure in the bundle. */
  figureLineage: FigureLineage[];
  /** The observation approvals, by observation id. */
  observationApprovals: Array<{ observationId: string; approvedBy: string; approvedAt: string; version: number; contentHash: string }>;
}

export interface BuildBundleInput {
  modelId: string;
  register: Register;
  locale: Locale;
  versions: EngineVersion;
  fixedTimestamp: string;
  graphRoot: string;
  renderHash: string;
  claims: Claim[];
  rendered: Array<{ claimId: string; phraseId: string; phraseVersion: number; text: string }>;
  lineage: FigureLineage[];
}

/** Build the export bundle for a frozen report. */
export async function buildBundle(input: BuildBundleInput): Promise<ReportBundle> {
  const textByClaim = new Map(input.rendered.map((r) => [r.claimId, r.text]));
  const ordered = [...input.claims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const leaves = ordered.map(claimCanonical);
  const tree = await buildMerkleTree(leaves);
  const leafHashes = await Promise.all(leaves.map((l) => sha256Hex(l)));

  const claims: BundleClaim[] = ordered.map((claim, i) => ({
    id: claim.id,
    kind: claim.kind,
    claimLevel: claim.claimLevel,
    phraseId: claim.phraseId,
    phraseVersion: claim.phraseVersion,
    canonical: leaves[i],
    claimHash: leafHashes[i],
    text: textByClaim.get(claim.id) ?? '',
    approval: claim.approval,
  }));

  const proofs = claims.map((c, i) => ({ claimId: c.id, proof: merkleProof(tree, i) }));

  const approvals = new Map<string, ReportBundle['observationApprovals'][number]>();
  for (const claim of ordered) {
    if (claim.approval) {
      approvals.set(claim.approval.observationId, {
        observationId: claim.approval.observationId,
        approvedBy: claim.approval.approvedBy,
        approvedAt: claim.approval.approvedAt,
        version: claim.approval.observationVersion,
        contentHash: claim.approval.contentHash,
      });
    }
  }

  return {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_VERSION,
    modelId: input.modelId,
    register: input.register,
    locale: input.locale,
    versions: input.versions,
    fixedTimestamp: input.fixedTimestamp,
    graphRoot: tree.root,
    renderHash: input.renderHash,
    claims,
    proofs,
    figureLineage: input.lineage,
    observationApprovals: [...approvals.values()].sort((a, b) => (a.observationId < b.observationId ? -1 : 1)),
  };
}

/** A stable, sorted-key JSON form, so the bundle serialises identically every time. */
export function serialiseBundle(bundle: ReportBundle): string {
  return canonicalise(bundle as unknown as CanonicalValue);
}

/** SHA-256 of the serialised bundle, for a content address. */
export async function bundleHash(bundle: ReportBundle): Promise<string> {
  return sha256Hex(serialiseBundle(bundle));
}
