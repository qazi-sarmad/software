/**
 * The report font catalogue (WP-F). Self-hosted Google Fonts, no external request.
 *
 * Every family here is an Open Font Licence face shipped by an `@fontsource` package: the files are
 * part of the bundle, so choosing a report font costs nothing to operate — no Google Fonts request,
 * no API key, no per-render fee, and it works offline and inside the tenant boundary.
 *
 * This module is pure: a catalogue, a validator and a deterministic file-name mapping. The bytes are
 * loaded (browser IO) by `src/data/fontBytes.ts`; the PDF renderer receives them as an argument, as
 * it already does. A format may only choose a family in this catalogue, exactly as it may only choose
 * a register the model allows.
 */

export interface ReportFontFamily {
  /** The CSS family name and the value stored in a format's layout. */
  family: string;
  /** The `@fontsource` package slug the file names derive from. */
  packageSlug: string;
  category: 'sans' | 'serif';
  /** The weights the package ships for the latin subset and the UI loads. */
  weights: number[];
}

/**
 * The curated set. Two sans (Inter, IBM Plex Sans) and four serif (Source Serif 4, Lora, Merriweather,
 * Libre Baskerville). This is deliberately small: a curated list is what makes a picker intuitive,
 * and every entry is real, embedded, and free.
 */
export const REPORT_FONT_FAMILIES: ReportFontFamily[] = [
  { family: 'Inter', packageSlug: 'inter', category: 'sans', weights: [400, 500, 600, 700] },
  { family: 'IBM Plex Sans', packageSlug: 'ibm-plex-sans', category: 'sans', weights: [400, 600] },
  { family: 'Source Serif 4', packageSlug: 'source-serif-4', category: 'serif', weights: [400, 600] },
  { family: 'Lora', packageSlug: 'lora', category: 'serif', weights: [400, 600] },
  { family: 'Merriweather', packageSlug: 'merriweather', category: 'serif', weights: [400, 700] },
  { family: 'Libre Baskerville', packageSlug: 'libre-baskerville', category: 'serif', weights: [400] },
];

export const REPORT_FONT_NAMES: string[] = REPORT_FONT_FAMILIES.map((f) => f.family);

export const DEFAULT_FONT_HEADING = 'Source Serif 4';
export const DEFAULT_FONT_BODY = 'Inter';

/** Whether a family is in the catalogue. A format may not choose outside it. */
export function isAllowedFontFamily(family: string): boolean {
  return REPORT_FONT_FAMILIES.some((f) => f.family === family);
}

/** The catalogue entry for a family, or undefined. */
export function fontFamily(family: string): ReportFontFamily | undefined {
  return REPORT_FONT_FAMILIES.find((f) => f.family === family);
}

/** The nearest allowed weight for a family, so a request for 700 on a 400-only face resolves. */
export function resolveWeight(family: string, weight: number): number {
  const entry = fontFamily(family);
  if (!entry) return 400;
  if (entry.weights.includes(weight)) return weight;
  return entry.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), entry.weights[0]);
}

/**
 * The `@fontsource` file stem for a family and weight, e.g. `inter-latin-400-normal`. Deterministic,
 * so the byte loader and the tests agree on the exact file without a lookup table.
 */
export function fontFileStem(family: string, weight: number): string {
  const entry = fontFamily(family);
  if (!entry) throw new Error(`unknown font family "${family}"`);
  return `${entry.packageSlug}-latin-${resolveWeight(family, weight)}-normal`;
}
