/**
 * Explain layer — shared types (docs/EXPLAIN-LAYER.md §1-§2).
 *
 * The explain layer has one distinction that keeps it safe (Law L2): static product documentation,
 * which any signed-in user may read, and contextual values, which are tenant data and must pass the
 * same view-access filter as the host screen. Everything here is data and pure logic — no clock
 * reads, no network, no tenant content in the catalogue itself.
 */
import type { Right } from '../rights';

export type ExplainKind =
  | 'method'
  | 'field'
  | 'term'
  | 'status'
  | 'step'
  | 'screen'
  | 'standard';

/**
 * One explainable thing. Authored and version-controlled, like a manual: never generated, never
 * tenant-specific. `effect` must state a consequence, not restate the summary.
 */
export interface ExplainEntry {
  /** Stable, namespaced id, e.g. `method.mus_pps`, `field.engagement.stage`, `standard.13.2`. */
  id: string;
  kind: ExplainKind;
  /** The label shown in the UI. */
  title: string;
  /** ONE sentence: what it is. */
  summary: string;
  /** ONE sentence: what choosing/using it will DO. */
  effect: string;
  detail?: string[];
  howItWorks?: string[];
  whenToUse?: string[];
  whenNotToUse?: string[];
  /** Verified IIA 2024 standard numbers (docs/iia-standards-reference.md). */
  iiaStandards?: string[];
  /** View-access gate. Omit for content that is public to any signed-in user. */
  minRight?: Right;
  /** Related explain ids — powers drilldown between entries. */
  related?: string[];
  /** Where the claim comes from (spec section, standard). */
  source?: string;
}

/**
 * A contextual value the HOST SCREEN has already filtered through `src/lib/access.ts`. The popout
 * only ever displays values it was handed; it never queries and never decides access to tenant data.
 */
export interface ExplainContextValue {
  label: string;
  value: string;
  /** If set, the value is dropped when the caller lacks the right. */
  minRight?: Right;
}

export interface ExplainContext {
  values?: ExplainContextValue[];
  /**
   * The current instant, as an argument. Pure functions never read the clock (Laws); a caller that
   * needs an age passes `now`.
   */
  now?: string;
}

export type ExplainStatus = 'ready' | 'denied';

/** The shape `explainFor` always returns. It is never null — a missing popout looks like a bug. */
export interface ExplainView {
  id: string;
  status: ExplainStatus;
  kind: ExplainKind;
  title: string;
  summary: string;
  effect: string;
  detail: string[];
  howItWorks: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  iiaStandards: string[];
  related: string[];
  source?: string;
  /** The contextual values the caller may see, after redaction. */
  values: ExplainContextValue[];
  /** Set when `status` is `denied`, in plain language. */
  deniedReason?: string;
}
