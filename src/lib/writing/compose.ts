/**
 * The composer: `text = render(graph, model, formality, tone, voice, locale, engine_version,
 * template_version, phrase_library_version, fixed_timestamp)`. No other input.
 *
 * The composer is a pure function. It reads no clock, no random source and no network. It selects,
 * for each claim, the released phrase variant for the register and locale, renders its template with
 * the claim's typed slots, and assembles the sentence. The graph root it returns is identical for
 * every register and locale; only the render hash changes.
 */

import { graphHashes, renderHash, GraphHashes } from './graph';
import { assertNoHighConsequence, leadIn, selectPhrase, CalibratedVocabulary } from './phrases';
import { realise, RealisationInput } from './realisation';
import { renderTemplate, SlotFormatContext } from './realise';
import { registerKey } from './registers';
import type { Claim, ClaimGraph, EngineVersion, Locale, Phrase, Register, Slot } from './types';

export interface ComposerInput {
  graph: ClaimGraph;
  phrases: Phrase[];
  vocabulary: CalibratedVocabulary;
  versions: EngineVersion;
  fixedTimestamp: string;
  /** The slot format context: scale, rounding, grouping and the currency symbol. */
  format: Omit<SlotFormatContext, 'locale'>;
  /** Human-authored overrides keyed by phrase id: the formality variant and optional per-tone and
   *  per-voice variants. Absent means the phrase's own template is used at every cell. */
  variants?: Record<string, PhraseVariants>;
}

/** The human-authored wording variants of one phrase across the matrix. */
export interface PhraseVariants {
  /** The variant per formality level, at the default tone and active voice. */
  byFormality: Record<number, string>;
  /** The passive-voice variant per formality level. Absent means the voice rule applies. */
  byPassive?: Record<number, string>;
  /** An optional override for one cell, keyed by `f<t>-t<tone>-<voice>-<locale>`. */
  byCell?: Record<string, string>;
}

export interface RenderedClaim {
  claimId: string;
  sectionId: string;
  phraseId: string;
  phraseVersion: number;
  text: string;
}

export interface ComposedReport {
  modelId: string;
  register: Register;
  locale: Locale;
  rendered: RenderedClaim[];
  hashes: GraphHashes;
  renderHash: string;
}

/**
 * The phrase template for a claim at a register: the formality variant, and a per-cell override when
 * one is authored. The tone and voice rules are applied afterwards by the realisation step; a
 * human-authored passive variant is passed to that step as an override rather than substituted here.
 */
function templateFor(claim: Claim, phrase: Phrase, variants: Record<string, PhraseVariants> | undefined,
  register: Register): string {
  const variant = variants?.[phrase.id];
  if (!variant) return phrase.template;
  const cellKey = registerKey(register, phrase.locale);
  const cell = variant.byCell?.[cellKey];
  if (cell) return cell;
  return variant.byFormality[register.formality] ?? phrase.template;
}

/**
 * Compose a report. Deterministic: the same input always produces the same rendered text and the
 * same two hashes.
 */
export async function composeReport(input: ComposerInput): Promise<ComposedReport> {
  const { graph, phrases, vocabulary, versions, fixedTimestamp, format, variants } = input;
  const { register, locale } = graph;
  const rendered: RenderedClaim[] = [];
  const ctx: SlotFormatContext = { ...format, locale };

  for (const claim of graph.claims) {
    let text: string;
    if (claim.kind === 'auditor') {
      // Auditor text is the auditor's own wording; the engine does not re-word it (W5.4).
      text = claim.auditorText ?? '';
    } else {
      const phrase = selectPhrase(phrases, claim.phraseId, slotData(claim), locale, graph.modelId);
      if (!phrase) {
        throw new Error(`Missing: [phrase for ${claim.phraseId} v${claim.phraseVersion} at `
          + `${registerKey(register, locale)}]`);
      }
      const template = templateFor(claim, phrase, variants, register);
      const base = renderTemplate(template, claim.slots, ctx);
      // A human-authored passive variant is rendered with the same slots, then passed as the voice
      // override, so the passive text is produced once and never transformed a second time.
      const passiveVariant = variants?.[phrase.id]?.byPassive?.[register.formality];
      const passiveText = passiveVariant ? renderTemplate(passiveVariant, claim.slots, ctx) : undefined;
      const realisation: RealisationInput = {
        formalityVariant: base,
        register,
        locale,
        passiveOverride: passiveText,
      };
      const realised = realise(realisation);
      const lead = leadIn(vocabulary, claim.claimLevel, registerKey(register, locale));
      text = lead ? `${lead} ${lowerFirst(realised)}` : realised;
    }
    // The ban is enforced here as well as at the lint and the freeze (W2.6).
    assertNoHighConsequence(text, vocabulary.highConsequence, `claim ${claim.id}`);
    rendered.push({
      claimId: claim.id, sectionId: claim.sectionId, phraseId: claim.phraseId,
      phraseVersion: claim.phraseVersion, text,
    });
  }

  const hashes = await graphHashes(graph.claims);
  const rh = await renderHash({
    graphRoot: hashes.graphRoot,
    register,
    locale,
    versions,
    rendered,
    fixedTimestamp,
  });
  return { modelId: graph.modelId, register, locale, rendered, hashes, renderHash: rh };
}

/** The typed data a phrase condition reads: the slot values by name, plus the claim level. */
export function slotData(claim: Claim): Record<string, unknown> {
  const data: Record<string, unknown> = { claimLevel: claim.claimLevel, kind: claim.kind };
  for (const slot of claim.slots) data[slot.name] = slot.value;
  return data;
}

function lowerFirst(text: string): string {
  return text.length ? text[0].toLowerCase() + text.slice(1) : text;
}

/** A convenience for tests and callers: the plain text of a composed report. */
export function composedText(report: ComposedReport): string {
  return report.rendered.map((r) => r.text).join('\n');
}

export type { Slot };
