/**
 * Capability registry — the mount point that lists each capability family with its owning stream and
 * its module path (docs/build/OWNERSHIP.md §4.3).
 *
 * A capability family is a group of deterministic capabilities that share a kind. Today one family
 * per kind exists in `src/lib/capabilities/index.ts` (the D1–D4 library). A stream that adds a family
 * adds a row here and a module file; it does not edit another stream's module. This is a pure data
 * module: no React, no client, no clock.
 */
import type { CapabilityKind } from '../../data/capabilities';

/** The concurrent-build stream that owns a capability family (OWNERSHIP.md §1). */
export type CapabilityOwner = 'trunk' | 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7';

export interface CapabilityFamily {
  /** The capability kind this family evaluates. */
  kind: CapabilityKind;
  /** A short human label for the family. */
  label: string;
  /** The stream that owns the family. */
  owner: CapabilityOwner;
  /** The module path, relative to the repository root. */
  path: string;
}

/**
 * The capability families. The D1–D4 library is the trunk's and is mounted; a stream's family is
 * added here when its module lands. Kept in the same order as `CAPABILITY_CATALOG`'s kinds.
 */
export const CAPABILITY_FAMILIES: CapabilityFamily[] = [
  { kind: 'risk_control', label: 'Risk and control', owner: 'trunk', path: 'src/lib/capabilities/riskControl.ts' },
  { kind: 'population_evidence', label: 'Population and evidence', owner: 'trunk', path: 'src/lib/capabilities/populationEvidence.ts' },
  { kind: 'process_governance', label: 'Process and governance', owner: 'trunk', path: 'src/lib/capabilities/processGovernance.ts' },
  { kind: 'assurance_ops', label: 'Assurance operations', owner: 'trunk', path: 'src/lib/capabilities/assuranceOps.ts' },
];

/** The family for a capability kind, or undefined when the registry does not know it. */
export function capabilityFamily(kind: CapabilityKind): CapabilityFamily | undefined {
  return CAPABILITY_FAMILIES.find((f) => f.kind === kind);
}

/** Every family a stream owns. */
export function familiesForStream(owner: CapabilityOwner): CapabilityFamily[] {
  return CAPABILITY_FAMILIES.filter((f) => f.owner === owner);
}
