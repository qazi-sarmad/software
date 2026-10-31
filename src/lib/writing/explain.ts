/**
 * W6: explainability. Why does this sentence read as it does?
 *
 * 6.1 A provenance trace per sentence: the phrase id and version, the rule that selected it, the
 *     condition values that held, the bound slots and their lineage, the register and locale, and the
 *     engine version. Stored with the claim; shown on demand.
 * 6.2 A deterministic counterfactual: "this sentence would read X if value Y were Z", or "in formal
 *     register this reads ...", computed by re-running the pure render with the changed input, never
 *     by inference.
 * 6.3 The trace reconstructs the exact sentence; tampering with a stored trace is detected by the
 *     claim hash.
 */

import { hashParts } from './canonical';
import { composeReport, type ComposerInput, type RenderedClaim } from './compose';
import { conditionHolds, selectPhrase } from './phrases';
import { registerKey } from './registers';
import type { Claim, Locale, Register, Slot } from './types';

export interface ProvenanceTrace {
  claimId: string;
  phraseId: string;
  phraseVersion: number;
  ruleId: string;
  ruleVersion: number;
  /** The condition values that held, by field. */
  conditionValues: Record<string, string | number | boolean | string[]>;
  /** The bound slots, by name, with the kind and the canonical value. */
  slots: Array<{ name: string; kind: string; value: string }>;
  register: Register;
  locale: Locale;
  engineVersion: string;
  /** The exact sentence the trace reconstructs. */
  sentence: string;
  /** A hash over the trace, so tampering is detected. */
  traceHash: string;
}

/** The typed data a phrase condition reads, from a claim's slots. */
function conditionValues(claim: Claim): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const slot of claim.slots) {
    const v = slot.value;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) {
      out[slot.name] = v;
    } else if (v && typeof v === 'object' && 'units' in v && 'scale' in v) {
      out[slot.name] = `${(v as { units: string }).units}e-${(v as { scale: number }).scale}`;
    }
  }
  return out;
}

function canonicalSlotValue(value: Slot['value']): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !Array.isArray(value) && 'units' in value) {
    return `${(value as { units: string }).units}/${(value as { scale: number }).scale}`;
  }
  return String(value);
}

/** The trace hash: a hash over the trace body. */
export function traceHash(body: Omit<ProvenanceTrace, 'traceHash'>): Promise<string> {
  return hashParts([
    'trace',
    body.claimId,
    body.phraseId,
    String(body.phraseVersion),
    body.ruleId,
    String(body.ruleVersion),
    JSON.stringify(body.conditionValues),
    ...body.slots.map((s) => `${s.name}=${s.kind}:${s.value}`),
    String(body.register.formality),
    String(body.register.tone),
    body.register.voice,
    body.locale,
    body.engineVersion,
    body.sentence,
  ]);
}

/**
 * W6.1: build the provenance trace for one rendered claim. The trace is stored with the claim and
 * reconstructs the exact sentence.
 */
export async function provenanceTrace(claim: Claim, rendered: RenderedClaim, register: Register,
  locale: Locale, engineVersion: string, phrases: ComposerInput['phrases']): Promise<ProvenanceTrace> {
  const phrase = selectPhrase(phrases, claim.phraseId, conditionValues(claim), locale, claim.modelId);
  const body: Omit<ProvenanceTrace, 'traceHash'> = {
    claimId: claim.id,
    phraseId: claim.phraseId,
    phraseVersion: claim.phraseVersion,
    ruleId: claim.ruleId,
    ruleVersion: claim.ruleVersion,
    conditionValues: conditionValues(claim),
    slots: claim.slots.map((s) => ({ name: s.name, kind: s.kind, value: canonicalSlotValue(s.value) })),
    register,
    locale,
    engineVersion,
    sentence: rendered.text,
  };
  // The phrase must exist and its condition must have held, or the trace is not a true explanation.
  if (!phrase) throw new Error(`trace: no released phrase for ${claim.phraseId} at ${registerKey(register, locale)}`);
  if (!conditionHolds(phrase.condition, conditionValues(claim))) {
    throw new Error(`trace: the condition for ${claim.phraseId} did not hold`);
  }
  return { ...body, traceHash: await traceHash(body) };
}

/** Verify a stored trace still describes the claim and the sentence. */
export async function verifyTrace(trace: ProvenanceTrace, claim: Claim, rendered: RenderedClaim): Promise<boolean> {
  const body: Omit<ProvenanceTrace, 'traceHash'> = { ...trace };
  delete (body as Partial<ProvenanceTrace>).traceHash;
  const recomputed = await traceHash(body);
  return recomputed === trace.traceHash
    && trace.claimId === claim.id
    && trace.sentence === rendered.text
    && trace.slots.map((s) => s.name).join(',') === claim.slots.map((s) => s.name).join(',');
}

export interface Counterfactual {
  /** A description of the change, in plain words. */
  description: string;
  /** The sentence the change produces. */
  sentence: string;
}

/**
 * W6.2: the deterministic counterfactual. Re-run the pure render with the changed input; never
 * infer. `change` is a slot substitution or a register substitution.
 */
export async function counterfactualSlot(input: ComposerInput, claimId: string, slotName: string,
  newValue: Slot['value']): Promise<Counterfactual> {
  const graph = {
    ...input.graph,
    claims: input.graph.claims.map((c) => c.id === claimId
      ? { ...c, slots: c.slots.map((s) => (s.name === slotName ? { ...s, value: newValue } : s)) }
      : c),
  };
  const report = await composeReport({ ...input, graph });
  const rendered = report.rendered.find((r) => r.claimId === claimId)!;
  return {
    description: `if ${slotName} were ${canonicalSlotValue(newValue)}`,
    sentence: rendered.text,
  };
}

/** The register counterfactual: the same facts in another register. */
export async function counterfactualRegister(input: ComposerInput, claimId: string,
  register: Register): Promise<Counterfactual> {
  const report = await composeReport({ ...input, graph: { ...input.graph, register } });
  const rendered = report.rendered.find((r) => r.claimId === claimId)!;
  return {
    description: `in formality ${register.formality}, tone ${register.tone}, ${register.voice} voice`,
    sentence: rendered.text,
  };
}
