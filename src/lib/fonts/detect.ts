/**
 * Font, colour and page-setup auto-detection from a client's own template (F5, F6;
 * docs/FONT-REPOSITORY.md §3.4, docs/SYSTELIGON.md §9.2).
 *
 * Rather than making an admin pick fonts and colours from a list, the product reads them out of an
 * uploaded `.docx` or `.pptx`. Both are OOXML zips with known parts, so this is a fixed XML read, not
 * a guess and not a model call (Law L1):
 *
 *   PPTX  `ppt/theme/theme1.xml`  — the colour scheme and the major/minor latin typefaces
 *   DOCX  `word/theme/theme1.xml` — the same scheme shape, and
 *   DOCX  `word/styles.xml`       — `docDefaults` run fonts and the Normal style, which is what a
 *                                    document actually prints in when it does not set a font inline
 *
 * The result is a PROPOSAL. It is deterministic given the bytes, it never mutates the format on its
 * own, and the caller decides whether to adopt it (F6). The module is pure apart from the zip read,
 * which is the browser's own IO; it executes nothing and expands no entities.
 */
import JSZip from 'jszip';
import { FONT_CATALOGUE, fontByFamily } from './catalogue';

/** A detected colour, as `#RRGGBB`. */
export type DetectedColour = string;

export interface DetectedTheme {
  /** The major (heading) latin typeface, when the theme declares one. */
  headingFont: string | null;
  /** The minor (body) latin typeface, when the theme declares one. */
  bodyFont: string | null;
  /** The theme's colour scheme, resolved to `#RRGGBB`, in OOXML order (dk1, lt1, dk2, lt2, accent1-6). */
  colours: DetectedColour[];
  /** The slide/page size in EMU (PPTX), when declared. */
  slideWidthEmu: number | null;
  slideHeightEmu: number | null;
  /** The format the theme was read from. */
  source: 'docx' | 'pptx';
  /** The media parts (logos, images) the archive carries. */
  mediaParts: string[];
  /** A plain-language note on what could and could not be read. */
  note: string;
}

/** The colour a proposal would map onto the org format, chosen from the detected scheme. */
export interface ThemeProposal {
  fontHeading: string | null;
  fontBody: string | null;
  colourPrimary: string | null;
  colourAccent: string | null;
  colourText: string | null;
  colourBackground: string | null;
  /** Which detected fonts are already in the repository, and which would need an upload (F4). */
  fontsBundled: string[];
  fontsToUpload: string[];
  /** True when there is something to adopt. */
  adoptable: boolean;
}

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? m[1] : null;
}

/** OOXML theme colour slots, in scheme order, mapped to the org branding field each informs. */
const COLOUR_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

/** Parse a `<a:clrScheme>` into `#RRGGBB` values, resolving `sysClr` (window/white) too. */
function parseColourScheme(schemeXml: string): DetectedColour[] {
  const out: DetectedColour[] = [];
  for (const slot of COLOUR_SLOTS) {
    const block = firstTag(schemeXml, `a:${slot}`);
    if (!block) continue;
    const srgb = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block);
    if (srgb) { out.push(`#${srgb[1].toUpperCase()}`); continue; }
    // `sysClr` carries the OS-resolved value in `lastClr`; that is the deterministic value to read.
    const sys = /<a:sysClr[^>]*\blastClr="([0-9A-Fa-f]{6})"/.exec(block);
    if (sys) out.push(`#${sys[1].toUpperCase()}`);
  }
  return out;
}

/** Parse the major/minor latin typefaces from a theme's `<a:fontScheme>`. */
function parseFontScheme(fontSchemeXml: string): { heading: string | null; body: string | null } {
  const major = /<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(fontSchemeXml);
  const minor = /<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/.exec(fontSchemeXml);
  return {
    heading: major && major[1].trim() ? major[1].trim() : null,
    body: minor && minor[1].trim() ? minor[1].trim() : null,
  };
}

/** Parse the run fonts a DOCX `styles.xml` sets in `docDefaults`. */
function parseDocxDefaultFonts(stylesXml: string): { heading: string | null; body: string | null } {
  const docDefaults = firstTag(stylesXml, 'w:docDefaults') ?? stylesXml;
  const ascii = /<w:rFonts[^>]*\bw:ascii="([^"]+)"/.exec(docDefaults);
  const body = ascii ? ascii[1].trim() : null;
  // A heading font, if the document declares one, comes from the theme; DOCX rarely sets it in the
  // defaults, so the body font is the honest answer for both when only one is present.
  return { heading: body, body };
}

async function readPart(zip: JSZip, candidates: string[]): Promise<string> {
  for (const name of candidates) {
    const key = Object.keys(zip.files).find((p) => p.toLowerCase() === name.toLowerCase());
    if (key) return zip.files[key].async('string');
  }
  return '';
}

/**
 * Detect the theme in a DOCX or PPTX archive. The bytes are the file's; nothing else is read.
 */
export async function detectTheme(bytes: Uint8Array, source: 'docx' | 'pptx'): Promise<DetectedTheme> {
  const zip = await JSZip.loadAsync(bytes);
  const themePath = source === 'pptx' ? 'ppt/theme/theme1.xml' : 'word/theme/theme1.xml';
  const themeXml = await readPart(zip, [themePath, themePath.replace('theme1', 'theme2')]);

  const colourScheme = themeXml ? firstTag(themeXml, 'a:clrScheme') ?? '' : '';
  const fontScheme = themeXml ? firstTag(themeXml, 'a:fontScheme') ?? '' : '';
  const colours = colourScheme ? parseColourScheme(colourScheme) : [];
  let fonts = fontScheme ? parseFontScheme(fontScheme) : { heading: null, body: null };

  // DOCX: fall back to the styles' document defaults, which is what the document actually prints in.
  if (source === 'docx' && !fonts.body) {
    const stylesXml = await readPart(zip, ['word/styles.xml']);
    if (stylesXml) {
      const def = parseDocxDefaultFonts(stylesXml);
      fonts = { heading: fonts.heading ?? def.heading, body: fonts.body ?? def.body };
    }
  }

  let slideWidthEmu: number | null = null;
  let slideHeightEmu: number | null = null;
  if (source === 'pptx') {
    const pres = await readPart(zip, ['ppt/presentation.xml']);
    if (pres) {
      const w = /<p:sldSz[^>]*\bcx="(\d+)"/.exec(pres);
      const h = /<p:sldSz[^>]*\bcy="(\d+)"/.exec(pres);
      if (w) slideWidthEmu = Number(w[1]);
      if (h) slideHeightEmu = Number(h[1]);
    }
  }

  const mediaParts = Object.keys(zip.files).filter((p) =>
    source === 'pptx' ? /^ppt\/media\/.*\.(png|jpe?g|svg)$/i.test(p) : /^word\/media\/.*\.(png|jpe?g|svg)$/i.test(p)
  );

  const note = colours.length === 0 && !fonts.body
    ? 'No theme colours or fonts could be read from this file; the current format is unchanged.'
    : `Read ${colours.length} theme colour(s) and ${fonts.body ? 'a body font' : 'no body font'} from the file's own theme.`;

  return {
    headingFont: fonts.heading, bodyFont: fonts.body, colours,
    slideWidthEmu, slideHeightEmu, source, mediaParts, note,
  };
}

/** Map a DOCX style-level font name to the nearest repository family, or null when it is not bundled. */
export function resolveBundledFont(name: string | null): string | null {
  if (!name) return null;
  const exact = fontByFamily(name);
  if (exact) return exact.family;
  // A theme often names a family with a variant suffix ("Inter Light", "Calibri (Body)"). Match on
  // the leading family word, case-insensitively, against the repository's families.
  const lead = name.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase();
  const hit = FONT_CATALOGUE.find(
    (f) => lead === f.family.toLowerCase() || lead.startsWith(f.family.toLowerCase() + ' ')
  );
  return hit ? hit.family : null;
}

/**
 * Turn a detected theme into a proposal the admin can adopt (F6). The mapping is fixed and
 * documented so it is testable and explainable:
 *   background = lt1 (the light page colour)   text  = dk1 (the dark ink colour)
 *   primary    = accent1                        accent = accent2
 * When a slot is missing the field stays null and the format's current value is kept.
 */
export function proposeTheme(theme: DetectedTheme): ThemeProposal {
  const at = (i: number): string | null => theme.colours[i] ?? null;
  const heading = resolveBundledFont(theme.headingFont);
  const body = resolveBundledFont(theme.bodyFont);
  const bundled = [heading, body].filter((x): x is string => x !== null);
  const toUpload = [theme.headingFont, theme.bodyFont]
    .filter((x): x is string => x !== null && resolveBundledFont(x) === null);

  const proposal: ThemeProposal = {
    fontHeading: heading ?? theme.headingFont,
    fontBody: body ?? theme.bodyFont,
    colourBackground: at(1),
    colourText: at(0),
    colourPrimary: at(4),
    colourAccent: at(5),
    fontsBundled: [...new Set(bundled)],
    fontsToUpload: [...new Set(toUpload)],
    adoptable: false,
  };
  proposal.adoptable = Boolean(
    proposal.fontHeading || proposal.fontBody || proposal.colourPrimary || proposal.colourAccent ||
    proposal.colourText || proposal.colourBackground
  );
  return proposal;
}
