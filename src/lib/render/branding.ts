/**
 * The BrandingSpec (F9): one plain object every shared renderer consumes. It is built from the
 * database row (get_branding) and carries colours as data, never as a hex literal in a component.
 *
 * Pure: no database client, no DOM. The renderers (renderPdf, renderPptx, renderQr) and the
 * on-screen preview all read this shape, so the same branding drives the Board Pack, the
 * certificate and the issued report.
 */

/** A colour is a token name or a CSS colour value supplied by the org. It is data, never a constant. */
export type ColourValue = string;

export interface BrandingSpec {
  orgId: string;
  fontHeading: string;
  fontBody: string;
  colourPrimary: ColourValue;
  colourAccent: ColourValue;
  colourText: ColourValue;
  colourBackground: ColourValue;
  logoLightAssetId: string | null;
  logoDarkAssetId: string | null;
  pageSize: 'A4' | 'Letter';
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  headerText: string;
  footerText: string;
  coverStyle: 'standard' | 'minimal' | 'bold';
  reportFormat: string;
  pptxTheme: Record<string, unknown> | null;
}

/** Page dimensions in points (1 pt = 1/72 in) and inches. */
export interface PageDimensions {
  widthPt: number;
  heightPt: number;
  widthIn: number;
  heightIn: number;
}

const A4 = { widthPt: 595.28, heightPt: 841.89 };
const LETTER = { widthPt: 612, heightPt: 792 };

export function pageDimensions(size: BrandingSpec['pageSize']): PageDimensions {
  const d = size === 'Letter' ? LETTER : A4;
  return { ...d, widthIn: d.widthPt / 72, heightIn: d.heightPt / 72 };
}

/** The fallback spec used before an org sets anything, and by the live preview. */
export const DEFAULT_BRANDING: Omit<BrandingSpec, 'orgId'> = {
  fontHeading: 'Helvetica',
  fontBody: 'Helvetica',
  colourPrimary: 'brand-primary',
  colourAccent: 'brand-accent',
  colourText: 'brand-text',
  colourBackground: 'brand-background',
  logoLightAssetId: null,
  logoDarkAssetId: null,
  pageSize: 'A4',
  marginTopMm: 20,
  marginRightMm: 20,
  marginBottomMm: 20,
  marginLeftMm: 20,
  headerText: '',
  footerText: 'Page {page} of {pages}',
  coverStyle: 'standard',
  reportFormat: 'standard',
  pptxTheme: null,
};

/** Millimetres to points. */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

/**
 * A #rrggbb value for a colour input or a renderer. A value that is already hex is returned as-is; a
 * bare token name is resolved from the live CSS custom properties (design tokens) at runtime. Only
 * this module (not a component) carries the neutral fallback, so no component holds a hex value.
 */
export function resolveHexColour(value: ColourValue): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${value}`).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  }
  return '#888888';
}

/**
 * Resolve a colour value to a CSS custom-property reference. A value that is already a CSS colour
 * (hex, rgb(), hsl(), a named colour) is passed through; a bare token name becomes var(--name).
 * This is how the org's colours reach the DOM as CSS variables, never as literals in a component.
 */
export function toCssColour(value: ColourValue, tokens: Record<string, string> = {}): string {
  if (!value) return 'inherit';
  if (tokens[value]) return tokens[value];
  if (/^(#|rgb|hsl|oklch|lab|color\()/i.test(value)) return value;
  return `var(--${value})`;
}

/**
 * Substitute the header/footer variables (F9): org name, engagement title, page number, date,
 * classification. Unknown variables are left untouched, so a stray brace never silently disappears.
 */
export function fillTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/** Build a full spec from a get_branding row, filling every absent field from the defaults. */
export function brandingFromRow(row: Record<string, unknown>): BrandingSpec {
  const s = (k: string): string | null => {
    const v = row[k];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const n = (k: string, fallback: number): number => {
    const v = row[k];
    return typeof v === 'number' ? v : fallback;
  };
  return {
    orgId: String(row.org_id ?? ''),
    fontHeading: s('font_heading') ?? DEFAULT_BRANDING.fontHeading,
    fontBody: s('font_body') ?? DEFAULT_BRANDING.fontBody,
    colourPrimary: s('colour_primary') ?? DEFAULT_BRANDING.colourPrimary,
    colourAccent: s('colour_accent') ?? DEFAULT_BRANDING.colourAccent,
    colourText: s('colour_text') ?? DEFAULT_BRANDING.colourText,
    colourBackground: s('colour_background') ?? DEFAULT_BRANDING.colourBackground,
    logoLightAssetId: s('logo_light_asset_id'),
    logoDarkAssetId: s('logo_dark_asset_id'),
    pageSize: (s('page_size') as BrandingSpec['pageSize']) ?? DEFAULT_BRANDING.pageSize,
    marginTopMm: n('margin_top_mm', DEFAULT_BRANDING.marginTopMm),
    marginRightMm: n('margin_right_mm', DEFAULT_BRANDING.marginRightMm),
    marginBottomMm: n('margin_bottom_mm', DEFAULT_BRANDING.marginBottomMm),
    marginLeftMm: n('margin_left_mm', DEFAULT_BRANDING.marginLeftMm),
    headerText: s('header_text') ?? '',
    footerText: s('footer_text') ?? DEFAULT_BRANDING.footerText,
    coverStyle: (s('cover_style') as BrandingSpec['coverStyle']) ?? DEFAULT_BRANDING.coverStyle,
    reportFormat: s('report_format') ?? DEFAULT_BRANDING.reportFormat,
    pptxTheme: (row.pptx_theme as Record<string, unknown> | null) ?? null,
  };
}
