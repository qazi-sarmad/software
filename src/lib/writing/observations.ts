/**
 * W3.2: the approved-observation gate.
 *
 * A report is built ONLY from final-approved observations. An observation moves draft -> submitted
 * -> approved (or rejected). The engine composes claims from approved observations only; drafts,
 * in-review and rejected observations are excluded and listed with the reason. A claim derived from
 * an observation records the approval (who, when, version, content hash). If an approved observation
 * is later changed or reopened, every claim derived from it becomes stale (flagged by hash) and the
 * freeze is blocked until the report is recomposed.
 *
 * The lifecycle states below match migration 0030 (`draft`, `submitted`, `finding`, `issue`) plus
 * the review decision the reviewer or Audit Manager records. `approved` is the state that lets an
 * observation into a report; a `finding` is an approved observation that passed the readability
 * check and was promoted.
 */

import { hashParts } from './canonical';
import type { Claim } from './types';

/** The observation lifecycle. Only `approved` and `finding` may enter a report. */
export type ObservationState =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'finding'
  | 'rejected'
  | 'reopened';

/** The states the gate admits. */
export const APPROVED_STATES: ObservationState[] = ['approved', 'finding'];

export interface ObservationApproval {
  approvedBy: string;
  approvedAt: string;
  version: number;
  contentHash: string;
}

export interface Observation {
  id: string;
  orgId: string;
  engagementId: string;
  title: string;
  state: ObservationState;
  /** The structured sections, by role tag (spec §14.2). */
  sections: Record<string, string>;
  version: number;
  /** The content hash of the observation's structured data at this version. */
  contentHash: string;
  approval: ObservationApproval | null;
  /** Why the observation is not approved, when it is not. Shown in the excluded panel. */
  reason?: string;
}

export interface Exclusion {
  observationId: string;
  title: string;
  state: ObservationState;
  reason: string;
}

export interface GateResult {
  admitted: Observation[];
  excluded: Exclusion[];
}

/** The canonical hash of an observation's content: its sections and version, in sorted key order. */
export function observationContentHash(observation: Omit<Observation, 'contentHash'>): Promise<string> {
  const keys = Object.keys(observation.sections).sort();
  return hashParts([
    'observation',
    observation.id,
    String(observation.version),
    ...keys.flatMap((k) => [k, observation.sections[k] ?? '']),
  ]);
}

/**
 * Apply the gate. An observation is admitted when its state is final-approved and it carries an
 * approval record. Everything else is excluded with a reason a reader can act on.
 */
export function applyApprovalGate(observations: Observation[]): GateResult {
  const admitted: Observation[] = [];
  const excluded: Exclusion[] = [];
  for (const obs of observations) {
    if (APPROVED_STATES.includes(obs.state) && obs.approval) {
      admitted.push(obs);
    } else {
      excluded.push({
        observationId: obs.id,
        title: obs.title,
        state: obs.state,
        reason: obs.reason ?? reasonFor(obs),
      });
    }
  }
  // Deterministic order: by id.
  admitted.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  excluded.sort((a, b) => (a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0));
  return { admitted, excluded };
}

function reasonFor(obs: Observation): string {
  switch (obs.state) {
    case 'draft': return 'Draft: not yet submitted for review.';
    case 'submitted': return 'Submitted: awaiting review.';
    case 'in_review': return 'In review: not yet approved.';
    case 'rejected': return 'Rejected: the reviewer did not approve it.';
    case 'reopened': return 'Reopened: approval was withdrawn and the observation is being revised.';
    default: return 'Not approved.';
  }
}

/**
 * A claim is stale when the observation it derives from has changed since the claim was composed:
 * a different content hash, or a state that is no longer approved.
 */
export function isClaimStale(claim: Claim, observations: Map<string, Observation>): boolean {
  if (!claim.approval) return false;
  const obs = observations.get(claim.approval.observationId);
  if (!obs) return true;
  if (!APPROVED_STATES.includes(obs.state)) return true;
  return obs.contentHash !== claim.approval.contentHash
    || obs.version !== claim.approval.observationVersion;
}

export interface StalenessReport {
  staleClaims: string[];
  reopenedObservations: string[];
  /** True when the freeze must be blocked. */
  blocked: boolean;
}

/** Find every claim that went stale and every observation that was reopened. */
export function checkStaleness(claims: Claim[], observations: Map<string, Observation>): StalenessReport {
  const staleClaims: string[] = [];
  const reopened = new Set<string>();
  for (const claim of claims) {
    if (isClaimStale(claim, observations)) {
      staleClaims.push(claim.id);
      if (claim.approval) reopened.add(claim.approval.observationId);
    }
  }
  staleClaims.sort();
  return {
    staleClaims,
    reopenedObservations: [...reopened].sort(),
    blocked: staleClaims.length > 0,
  };
}

/** The approval a claim records, taken from its admitted observation. */
export function approvalFor(observation: Observation): ObservationApproval {
  if (!observation.approval) {
    throw new Error(`observation ${observation.id} is not approved`);
  }
  return observation.approval;
}
