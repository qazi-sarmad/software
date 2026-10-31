/**
 * The derived design theme (WP-D).
 *
 * The organisation sets four brand colours. Everything else the report prints — heading colour, rule
 * colour, link colour, table shades, shape fills — is DERIVED from those four by arithmetic, so a
 * client changes their brand in one place and the whole document follows. Nothing here is a hex
 * literal: every value is computed from the branding row, and the result is deterministic.
 *
 * Pure: no clock, no randomness, no DOM. The renderers and the canvas both read this one shape.
 */
import type { ColourValue } from '../render/branding';
import { alphaOver, contrastText, darken, lighten, mixHex, tint } from './colourMath';
import { DEFAULT_TABLE_STYLE, type TableStyleName } from './tableStyleDefaults';

/** The four brand colours plus the layout's own table choices, as the designer holds them. */
export interface DesignThemeInput {
  colourPrimary: ColourValue;
  colourAccent: ColourValue;
  colourText: ColourValue;
  colourBackground: ColourValue;
  tableBorder: ColourValue;
  tableRowAlternate: ColourValue;
  /** The format's default table style, applied to a table the designer does not style itself. */
  tableStyle: TableStyleName;
}

/** Every colour the report prints, derived once. All values are `#rrggbb`. */
export interface DesignTheme {
  primary: string;
  accent: string;
  text: string;
  background: string;
  /** The colour a level-1/2 heading prints in. */
  heading: string;
  /** The colour a level-3 heading and a table caption print in. */
  subheading: string;
  /** The colour a section rule and a header/footer rule print in. */
  rule: string;
  /** The colour body text prints in. */
  body: string;
  /** The colour a hyperlink and a cross-reference print in. */
  link: string;
  /** The colour a cross-reference's page number prints in. */
  reference: string;
  /** A pale surface for a callout or a shape fill. */
  surface: string;
  /** A mid surface for a shape that needs to read as a panel. */
  surfaceStrong: string;
  /** The fill for a callout shape. */
  calloutFill: string;
  /** The text colour to print on `calloutFill`. */
  calloutText: string;
  tableBorder: string;
  tableRowAlternate: string;
  tableStyle: TableStyleName;
}

/** The four brand colours, resolved to hex. A token name that the caller could not resolve arrives
 *  already as a hex value; `parseHex` in colourMath gives a defined fallback for anything else. */
export interface ResolvedBranding {
  primary: string;
  accent: string;
  text: string;
  background: string;
}

/**
 * Derive the full theme. Every ratio is fixed, so the same branding always yields the same theme:
 *   heading   = primary, darkened when the primary is too pale to read on the page;
 *   subheading= a 65% primary/accent mix, so a sub-heading sits between the two brand colours;
 *   rule      = the accent at 45% over the page, a hairline that reads without shouting;
 *   body      = the text colour;
 *   link      = the accent darkened, so a link is distinct from body text and still on-brand;
 *   reference = the link at 70%, so a cross-reference is quieter than the link it points at;
 *   surface   = the primary at 6% over the page; strong at 12%;
 *   callout   = the accent at 10% over the page, with a contrasting text colour.
 */
export function deriveTheme(input: DesignThemeInput, branding: ResolvedBranding): DesignTheme {
  const primary = branding.primary;
  const accent = branding.accent;
  const text = branding.text;
  const background = branding.background;

  // A brand colour too pale to read as a heading is darkened until it is legible on the page.
  const heading = readable(primary, background);
  const subheading = readable(mixHex(primary, accent, 0.65), background);
  const rule = alphaOver(accent, background, 0.45);
  const link = readable(darken(accent, 0.15), background);
  const reference = alphaOver(link, background, 0.7);
  const surface = alphaOver(primary, background, 0.06);
  const surfaceStrong = alphaOver(primary, background, 0.12);
  const calloutFill = alphaOver(accent, background, 0.1);

  return {
    primary, accent, text, background,
    heading,
    subheading,
    rule,
    body: text,
    link,
    reference,
    surface,
    surfaceStrong,
    calloutFill,
    calloutText: contrastText(calloutFill),
    tableBorder: input.tableBorder ? String(input.tableBorder) : darken(text, 0.2),
    tableRowAlternate: input.tableRowAlternate ? String(input.tableRowAlternate) : tint(primary, 0.94),
    tableStyle: input.tableStyle,
  };
}

/** Darken a colour until it contrasts with the page, or return it unchanged when it already does. */
function readable(value: string, background: string): string {
  let c = value;
  for (let i = 0; i < 6; i += 1) {
    if (contrastRatioLocal(c, background) >= 3) return c;
    c = darken(c, 0.12);
  }
  return c;
}

/** Local contrast check, kept here so the derivation reads as one function. */
function contrastRatioLocal(a: string, b: string): number {
  const lum = (v: string): number => {
    const c = parse(v);
    const chan = (n: number) => {
      const s = n / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parse(v: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
  if (!m) return { r: 136, g: 136, b: 136 };
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
}

/** The theme with the defaults applied, for a layout that has not been themed yet. */
export function defaultThemeInput(): DesignThemeInput {
  return {
    colourPrimary: '#2f6f5e',
    colourAccent: '#c9a227',
    colourText: '#14161b',
    colourBackground: '#ffffff',
    tableBorder: '#5f6573',
    tableRowAlternate: '#eef3f1',
    tableStyle: DEFAULT_TABLE_STYLE,
  };
}

/** A pale fill and its text colour, for a shape the designer drops on the page. */
export function shapePalette(theme: DesignTheme): { name: string; fill: string; stroke: string }[] {
  return [
    { name: 'brand', fill: theme.primary, stroke: darken(theme.primary, 0.2) },
    { name: 'accent', fill: theme.accent, stroke: darken(theme.accent, 0.2) },
    { name: 'surface', fill: theme.surface, stroke: theme.rule },
    { name: 'callout', fill: theme.calloutFill, stroke: theme.rule },
    { name: 'none', fill: 'none', stroke: theme.rule },
  ];
}

/** Lighten a colour for a highlight; re-exported so a component imports one module for the theme. */
export { lighten as themeLighten };
