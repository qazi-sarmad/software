/**
 * Deterministic prompt assembly and the TF-IDF cosine engine (F8).
 *
 * Prompt assembly is: system prompt + voice profile + terms + the top-k most similar samples of the
 * same kind (deterministic TF-IDF cosine) within a character budget + record context. Only the
 * tenant's own data is used. Pure and deterministic (L1): the same inputs always give the same
 * prompt, and no randomness enters the ranking or the tie-break.
 */

export interface VoiceProfile {
  tone: string;
  person: string;
  length: string;
  customInstructions?: string | null;
}

export interface VoiceTerm {
  preferredPhrase?: string | null;
  avoidPhrase?: string | null;
  glossaryTerm?: string | null;
  definition?: string | null;
}

export interface VoiceSample {
  id: string;
  kind: string;
  title?: string | null;
  text: string;
}

export interface PromptInput {
  systemPrompt: string;
  profile: VoiceProfile;
  terms: VoiceTerm[];
  samples: VoiceSample[];
  sampleKind: string;
  recordContext: string;
  brandingFacts?: string[];
  allowedNumbers: string[];
  topK?: number;
  charBudget?: number;
}

/** Tokenise to lowercase word tokens. Deterministic. */
export function tokenise(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1);
}

/** Term frequencies for a document. */
export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** Inverse document frequency over a corpus, in a deterministic order. */
export function inverseDocumentFrequency(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = docs.length || 1;
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  return idf;
}

/** Cosine similarity between two sparse TF-IDF vectors. Returns 0 when either vector is empty. */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [term, va] of a) {
    na += va * va;
    const vb = b.get(term);
    if (vb) dot += va * vb;
  }
  for (const vb of b.values()) nb += vb * vb;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Rank the samples of `kind` by TF-IDF cosine similarity to the record context and return the top k.
 * Ties break on sample id, so the result is stable.
 */
export function rankSamples(
  context: string, samples: VoiceSample[], kind: string, topK = 3
): { sample: VoiceSample; score: number }[] {
  const pool = samples.filter((s) => s.kind === kind);
  if (pool.length === 0) return [];
  const contextTokens = tokenise(context);
  const docs = [contextTokens, ...pool.map((s) => tokenise(`${s.title ?? ''} ${s.text}`))];
  const idf = inverseDocumentFrequency(docs);
  const vec = (tokens: string[]): Map<string, number> => {
    const tf = termFrequency(tokens);
    const out = new Map<string, number>();
    for (const [term, count] of tf) out.set(term, (count / tokens.length) * (idf.get(term) ?? 0));
    return out;
  };
  const contextVec = vec(contextTokens);
  const scored = pool.map((s, i) => ({ sample: s, score: cosineSimilarity(contextVec, vec(docs[i + 1])) }));
  scored.sort((x, y) => (y.score - x.score) || (x.sample.id < y.sample.id ? -1 : x.sample.id > y.sample.id ? 1 : 0));
  return scored.slice(0, topK);
}

/** The voice profile as plain statements, deterministic order. */
export function describeVoice(profile: VoiceProfile): string {
  const parts = [`Tone: ${profile.tone}.`, `Person: ${profile.person}.`, `Length: ${profile.length}.`];
  if (profile.customInstructions && profile.customInstructions.trim()) {
    parts.push(`Instructions: ${profile.customInstructions.trim()}`);
  }
  return parts.join(' ');
}

/** The terms as plain statements. */
export function describeTerms(terms: VoiceTerm[]): string {
  const lines: string[] = [];
  for (const t of terms) {
    if (t.preferredPhrase) lines.push(`Prefer the phrase "${t.preferredPhrase}".`);
    if (t.avoidPhrase) lines.push(`Avoid the phrase "${t.avoidPhrase}".`);
    if (t.glossaryTerm) lines.push(`Use "${t.glossaryTerm}" to mean ${t.definition ?? ''}.`.trim());
  }
  return lines.join('\n');
}

/**
 * Assemble the prompt within a character budget. The sample section is filled top-down until the
 * budget is reached, so the same inputs always give the same prompt.
 */
export function assemblePrompt(input: PromptInput): string {
  const topK = input.topK ?? 3;
  const budget = input.charBudget ?? 8000;
  const parts: string[] = [];
  parts.push(input.systemPrompt.trim());
  parts.push(describeVoice(input.profile));
  const termsText = describeTerms(input.terms);
  if (termsText) parts.push(termsText);
  if (input.brandingFacts && input.brandingFacts.length) {
    parts.push(input.brandingFacts.map((f) => `Formatting: ${f}`).join('\n'));
  }
  parts.push(`Numbers you may use: ${input.allowedNumbers.join(', ') || '(none)'}. Do not state any other number.`);
  parts.push(`Record context:\n${input.recordContext.trim()}`);
  let used = parts.join('\n\n').length;
  const ranked = rankSamples(input.recordContext, input.samples, input.sampleKind, topK);
  for (const { sample } of ranked) {
    const block = `Example of ${input.sampleKind} in our house style:\n${sample.text.trim()}`;
    if (used + block.length > budget) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n\n');
}
