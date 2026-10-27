/**
 * The bridge from a report format to the page-design model (WP-D).
 *
 * `ReportFormatPanel` and the renderers both call `designFromFormat`: the panel to draw the canvas,
 * the renderers to print. One function, one geometry, so the designer's page and the printed page
 * are the same page.
 *
 * Pure: the caller passes a `resolve` function that turns a design token (e.g. `brand-primary`) into
 * a hex value. Only the caller touches the DOM; this module never does.
 */
import type { FormatLayout } from './reportFormat';
import { deriveTheme, type DesignTheme, type DesignThemeInput, type ResolvedBranding } from './designTheme';
import { buildPages, defaultPlacedBlock, type BlockGeometry, type PageDesignInput, type PageModel } from './pageDesign';
import { tableStyle, type TableStyle, type TableTheme } from './tableStyles';
import type { TableStyleName } from './tableStyleDefaults';

/** A resolver that turns a colour token or hex value into an `#rrggbb` string. */
export type ColourResolver = (value: string) => string;

/** The page setup a layout implies. */
export function setupFromLayout(layout: FormatLayout) {
  return {
    pageSize: layout.pageSize,
    orientation: layout.orientation,
    marginTopMm: layout.marginTopMm,
    marginRightMm: layout.marginRightMm,
    marginBottomMm: layout.marginBottomMm,
    marginLeftMm: layout.marginLeftMm,
  };
}

/** The four brand colours, resolved to hex through the caller's resolver. */
export function brandingFromLayout(layout: FormatLayout, resolve: ColourResolver): ResolvedBranding {
  return {
    primary: resolve(layout.colourPrimary),
    accent: resolve(layout.colourAccent),
    text: resolve(layout.colourText),
    background: resolve(layout.colourBackground),
  };
}

/** The theme input a layout implies. */
export function themeInputFromLayout(layout: FormatLayout): DesignThemeInput {
  return {
    colourPrimary: layout.colourPrimary,
    colourAccent: layout.colourAccent,
    colourText: layout.colourText,
    colourBackground: layout.colourBackground,
    tableBorder: layout.tableBorder,
    tableRowAlternate: layout.tableRowAlternate,
    tableStyle: layout.defaultTableStyle,
  };
}

/** The derived theme for a layout, with the caller's colour resolver. */
export function themeFromLayout(layout: FormatLayout, resolve: ColourResolver): DesignTheme {
  return deriveTheme(themeInputFromLayout(layout), brandingFromLayout(layout, resolve));
}

/** The table theme a layout implies, once the brand colours are resolved. */
export function tableThemeFromLayout(layout: FormatLayout, theme: DesignTheme, resolve: ColourResolver): TableTheme {
  return {
    primary: theme.primary,
    accent: theme.accent,
    text: theme.text,
    background: theme.background,
    tableBorder: resolve(layout.tableBorder),
    tableRowAlternate: resolve(layout.tableRowAlternate),
  };
}

/** The resolved style for one table in the format. */
export function tableStyleFor(
  layout: FormatLayout, theme: DesignTheme, resolve: ColourResolver, key: string,
): TableStyle {
  const t = tableThemeFromLayout(layout, theme, resolve);
  const chosen: TableStyleName = layout.tableStyles.find((s) => s.key === key)?.style ?? layout.defaultTableStyle;
  return tableStyle(chosen, t);
}

/** Build the page-design input for a format. The caller supplies the block geometry (body lines). */
export function designInputFromFormat(
  layout: FormatLayout,
  typography: { headingPt: number; bodyPt: number; lineHeight: number },
  theme: DesignTheme,
  blocks: BlockGeometry[],
): PageDesignInput {
  const placedKeys = new Set(layout.placed.map((p) => p.key));
  return {
    setup: setupFromLayout(layout),
    grid: layout.grid,
    chrome: layout.chrome,
    columns: layout.columns,
    columnGapMm: layout.columnGapMm,
    theme,
    typography,
    blocks,
    // Every visible block gets a placement entry, so a block the designer never touched flows.
    placed: [
      ...layout.placed,
      ...blocks.filter((b) => !placedKeys.has(b.key)).map((b) => defaultPlacedBlock(b.key)),
    ],
    shapes: layout.shapes,
    numberedHeadings: layout.numberedHeadings,
  };
}

/** The page model for a format. The one call the canvas and the renderers share. */
export function pagesFromFormat(
  layout: FormatLayout,
  typography: { headingPt: number; bodyPt: number; lineHeight: number },
  theme: DesignTheme,
  blocks: BlockGeometry[],
): PageModel {
  return buildPages(designInputFromFormat(layout, typography, theme, blocks));
}
