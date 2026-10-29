/**
 * Loads the self-hosted report font bytes for embedding in a PDF (WP-F, F2/F6).
 *
 * The `@fontsource` files ship in the bundle; Vite rewrites each `?url` import to the emitted asset
 * URL. We fetch the bytes at render time and cache them, so the PDF embeds exactly the face the
 * canvas shows. Nothing leaves the tenant boundary and no external host is contacted.
 *
 * EVERY family in the report catalogue is imported, at every weight the catalogue declares, so a
 * format may choose any offered face and still embed it. The imports are static (not a glob) so the
 * emitted asset set is deterministic; `fontBytes.test.ts` pins that the map and the catalogue agree,
 * so a family added to the catalogue without its bytes fails the build rather than silently falling
 * back to the renderer's standard font.
 */
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import sourceSerif400 from '@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url';
import sourceSerif600 from '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url';
import jetbrainsMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url';
import jetbrainsMono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2?url';
import jetbrainsMono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff2?url';
import ibmPlexSans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import ibmPlexSans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url';
import ibmPlexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import ibmPlexMono600 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url';
import openSans400 from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff2?url';
import openSans600 from '@fontsource/open-sans/files/open-sans-latin-600-normal.woff2?url';
import atkinson400 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url';
import atkinson700 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url';
import lora400 from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import lora600 from '@fontsource/lora/files/lora-latin-600-normal.woff2?url';
import merriweather400 from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url';
import merriweather700 from '@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url';
import libreBaskerville400 from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff2?url';
import playfairDisplay400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url';
import playfairDisplay700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import robotoSlab400 from '@fontsource/roboto-slab/files/roboto-slab-latin-400-normal.woff2?url';
import robotoSlab700 from '@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff2?url';
import { resolveWeight } from '../lib/render/fonts';

/** family → weight → emitted asset URL. Every catalogue family, at every declared weight. */
const FONT_URLS: Record<string, Record<number, string>> = {
  Inter: { 400: inter400, 500: inter500, 600: inter600, 700: inter700 },
  'Source Serif 4': { 400: sourceSerif400, 600: sourceSerif600 },
  'JetBrains Mono': { 400: jetbrainsMono400, 500: jetbrainsMono500, 600: jetbrainsMono600 },
  'IBM Plex Sans': { 400: ibmPlexSans400, 600: ibmPlexSans600 },
  'IBM Plex Mono': { 400: ibmPlexMono400, 600: ibmPlexMono600 },
  'Open Sans': { 400: openSans400, 600: openSans600 },
  'Atkinson Hyperlegible': { 400: atkinson400, 700: atkinson700 },
  Lora: { 400: lora400, 600: lora600 },
  Merriweather: { 400: merriweather400, 700: merriweather700 },
  'Libre Baskerville': { 400: libreBaskerville400 },
  'Playfair Display': { 400: playfairDisplay400, 700: playfairDisplay700 },
  'Roboto Slab': { 400: robotoSlab400, 700: robotoSlab700 },
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
