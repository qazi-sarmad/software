/**
 * Loads the self-hosted report font bytes for embedding in a PDF (WP-F).
 *
 * The `@fontsource` files ship in the bundle; Vite rewrites each `?url` import to the emitted asset
 * URL. We fetch the bytes at render time and cache them, so the PDF embeds exactly the face the
 * canvas shows. Nothing leaves the tenant boundary and no external host is contacted.
 *
 * Only the families and weights in `src/lib/render/fonts.ts` are imported, so the bundle carries just
 * the curated set. The imports are static (not a glob) so the emitted asset set is deterministic.
 */
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import ibmPlexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import ibmPlexSans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url';
import sourceSerif400 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url';
import sourceSerif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url';
import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import lora600 from '@fontsource/lora/files/lora-latin-600-normal.woff2?url';
import merriweather400 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url';
import merriweather700 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url';
import libreBaskerville400 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff2?url';
import { resolveWeight } from '../lib/render/fonts';

/** family → weight → emitted asset URL. Only the catalogue's shipped weights appear. */
const FONT_URLS: Record<string, Record<number, string>> = {
  Inter: { 400: inter400, 500: inter500, 600: inter600, 700: inter700 },
  'IBM Plex Sans': { 400: ibmPlexSans400, 600: ibmPlexSans600 },
  'Source Serif 4': { 400: sourceSerif400, 600: sourceSerif600 },
  Lora: { 400: lora400, 600: lora600 },
  Merriweather: { 400: merriweather400, 700: merriweather700 },
  'Libre Baskerville': { 400: libreBaskerville400 },
};

const cache = new Map<string, Uint8Array>();

/** The emitted asset URL for a family and weight, or null when the family is not self-hosted. */
export function fontUrl(family: string, weight: number): string | null {
  const byWeight = FONT_URLS[family];
  if (!byWeight) return null;
  const w = resolveWeight(family, weight);
  return byWeight[w] ?? null;
}

/** Fetch and cache the bytes for a family and weight. Returns null when unavailable (offline, or a
 *  family outside the catalogue), so the renderer falls back to its standard font rather than fail. */
export async function loadFontBytes(family: string, weight: number): Promise<Uint8Array | null> {
  const url = fontUrl(family, weight);
  if (!url) return null;
  const key = `${family}-${resolveWeight(family, weight)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    cache.set(key, bytes);
    return bytes;
  } catch {
    return null;
  }
}

/** The heading and body font bytes for a report, ready for the PDF renderer's arguments. */
export async function loadReportFonts(
  heading: { family: string; weight: number },
  body: { family: string; weight: number },
): Promise<{ headingFontBytes?: Uint8Array; bodyFontBytes?: Uint8Array }> {
  const [h, b] = await Promise.all([
    loadFontBytes(heading.family, heading.weight),
    loadFontBytes(body.family, body.weight),
  ]);
  return { headingFontBytes: h ?? undefined, bodyFontBytes: b ?? undefined };
}
