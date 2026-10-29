/**
 * The font lazy loader (F2; docs/FONT-REPOSITORY.md §3.1).
 *
 * The three chrome families are imported eagerly by `src/index.css` because the shell renders them on
 * every page. Every OTHER family in the repository is lazy-loaded: a client pays for a font only when
 * they pick it. Each entry maps a family to a dynamic import of its `@fontsource` latin CSS, so Vite
 * code-splits the woff2 files out of the initial bundle.
 *
 * The loader is idempotent — a family already loaded is never loaded twice — and it is safe to call
 * for a family outside the catalogue (it resolves to `false` rather than throwing), so a stale format
 * that names a removed font degrades instead of crashing.
 */
import { fontByFamily, type FontFamilyEntry } from './catalogue';

/** family → the dynamic import of its latin CSS. Only non-chrome families appear here. */
const LOADERS: Record<string, () => Promise<unknown>> = {
  'IBM Plex Sans': () => import('@fontsource/ibm-plex-sans/latin-400.css').then(() => import('@fontsource/ibm-plex-sans/latin-600.css')),
  'IBM Plex Mono': () => import('@fontsource/ibm-plex-mono/latin-400.css').then(() => import('@fontsource/ibm-plex-mono/latin-600.css')),
  'Open Sans': () => import('@fontsource/open-sans/latin-400.css').then(() => import('@fontsource/open-sans/latin-600.css')),
  'Atkinson Hyperlegible': () => import('@fontsource/atkinson-hyperlegible/latin-400.css').then(() => import('@fontsource/atkinson-hyperlegible/latin-700.css')),
  Lora: () => import('@fontsource/lora/latin-400.css').then(() => import('@fontsource/lora/latin-600.css')),
  Merriweather: () => import('@fontsource/merriweather/latin-400.css').then(() => import('@fontsource/merriweather/latin-700.css')),
  'Libre Baskerville': () => import('@fontsource/libre-baskerville/latin-400.css'),
  'Playfair Display': () => import('@fontsource/playfair-display/latin-400.css').then(() => import('@fontsource/playfair-display/latin-700.css')),
  'Roboto Slab': () => import('@fontsource/roboto-slab/latin-400.css').then(() => import('@fontsource/roboto-slab/latin-700.css')),
};

const loaded = new Set<string>();

/** Whether a family has already been loaded in this session. */
export function isFontLoaded(family: string): boolean {
  return loaded.has(family);
}

/**
 * Load a family's latin CSS. Returns true when the family is now available, false when it is not in
 * the catalogue or has no lazy loader (a chrome family is already loaded by the shell).
 */
export async function loadFont(family: string): Promise<boolean> {
  const entry: FontFamilyEntry | undefined = fontByFamily(family);
  if (!entry) return false;
  if (loaded.has(family)) return true;
  const loader = LOADERS[family];
  if (!loader) {
    // A chrome family: index.css already imported it. Mark it so the check is cheap thereafter.
    loaded.add(family);
    return true;
  }
  await loader();
  loaded.add(family);
  return true;
}

/** Load several families, ignoring a family that cannot be loaded. */
export async function loadFonts(families: string[]): Promise<void> {
  await Promise.all(families.map((f) => loadFont(f).catch(() => false)));
}
