/**
 * The bridge from a report format to the render-time design (WP-D).
 *
 * The panel builds a design to draw the canvas; the renderers build the same design to print. One
 * function, `designFromFormat`, so the page the designer sees and the page that prints are the same.
 *
 * Pure, except that it calls the caller's `resolve` to turn a design token into a hex value. In the
 * browser that resolver reads the live CSS custom properties; in a test it returns the value as-is.
 */
import type { FormatLayout } from './reportFormat';
import { toPdfTypography } from './reportFormat';
import { deriveTheme, type DesignTheme } from './designTheme';
import type { DocumentDesign } from '../render/document';
import type { ColourResolver } from './formatDesign';
import { brandingFromLayout, tableThemeFromLayout, themeFromLayout } from './formatDesign';

export { themeFromLayout, brandingFromLayout, tableThemeFromLayout };

/** The design a renderer prints, built from a layout and the org's resolved brand colours. */
export function designFromFormat(
  layout: FormatLayout, resolve: ColourResolver, chromeVars: Record<string, string | number>,
): DocumentDesign {
  const theme: DesignTheme = themeFromLayout(layout, resolve);
  return {
    setup: {
      pageSize: layout.pageSize,
      orientation: layout.orientation,
      marginTopMm: layout.marginTopMm,
      marginRightMm: layout.marginRightMm,
      marginBottomMm: layout.marginBottomMm,
      marginLeftMm: layout.marginLeftMm,
    },
    grid: layout.grid,
    chrome: layout.chrome,
    theme,
    columns: layout.columns,
    columnGapMm: layout.columnGapMm,
    numberedHeadings: layout.numberedHeadings,
    placed: layout.placed,
    shapes: layout.shapes,
    links: layout.links,
    crossReferences: layout.crossReferences,
    tableStyles: layout.tableStyles,
    defaultTableStyle: layout.defaultTableStyle,
    tableBorder: resolve(layout.tableBorder),
    tableRowAlternate: resolve(layout.tableRowAlternate),
    chromeVars,
  };
}

/** Whether a layout asks for a designed page rather than the plain flow. */
export function hasDesign(layout: FormatLayout): boolean {
  return layout.columns > 1
    || layout.orientation === 'landscape'
    || layout.shapes.length > 0
    || layout.placed.some((p) => p.xMm !== null || p.yMm !== null)
    || layout.links.length > 0
    || layout.crossReferences.length > 0
    || layout.tableStyles.length > 0
    || layout.defaultTableStyle !== 'plain'
    || layout.chrome.headerEnabled
    || layout.chrome.footerEnabled
    || layout.numberedHeadings;
}

/** The resolved typography, re-exported so a caller imports one module for the render path. */
export { toPdfTypography };
