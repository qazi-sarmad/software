/**
 * Deterministic TF-IDF helpers (F15, S10).
 *
 * The cross-engagement pattern engine needs a tokeniser and TF-IDF cosine similarity. These are pure
 * and deterministic, so they live here rather than inside any feature module.
 */

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
