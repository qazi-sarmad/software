/**
 * The table-style catalogue (WP-D).
 *
 * A table in a report may be given a style, and each style is a coloured variant derived from the
 * organisation's own theme. The designer picks a style per table; the PDF, the DOCX and the canvas
 * all read the same resolved style, so the printed table is the table the designer chose.
 *
 * Pure: no clock, no randomness, no DOM. Every style is a total function of the theme, so the same
 * theme always yields the same shades.
 */
import { alphaOver, contrastText, darken, lighten } from './colourMath';
import { TABLE_STYLE_NAMES, type TableStyleName } from './tableStyleDefaults';

export { TABLE_STYLE_NAMES };
export type { TableStyleName };

/** The theme values a table style derives from. All are hex, resolved from the org's branding. */
export interface TableTheme {
  primary: string;
  accent: string;
  text: string;
  background: string;
  /** The format's table style choices. */
  tableBorder: string;
  tableRowAlternate: string;
}

/** A resolved table style: every value the three renderers need, and nothing they must compute. */
export interface TableStyle {
  name: TableStyleName;
  label: string;
  /** One sentence a designer reads in the picker. */
  description: string;
  headerBackground: string;
  headerText: string;
  border: string;
  /** The alternate row shade, or null for a style with no zebra striping. */
  rowAlternate: string | null;
  /** The border width in points; 0 draws no border. */
  borderPt: number;
}

export function isTableStyleName(v: unknown): v is TableStyleName {
  return typeof v === 'string' && (TABLE_STYLE_NAMES as readonly string[]).includes(v);
}

/**
 * The six styles, derived from the theme. Each is a different, readable treatment of the same data:
 *   plain  — no fills, hairline rules only;
 *   zebra  — alternating pale rows, no borders;
 *   boxed  — a full border, a neutral header;
 *   brand  — the brand colour in the header, white text;
 *   muted  — a pale header, no borders;
 *   bold   — a dark header and a heavier border.
 */
export function tableStyle(name: TableStyleName, theme: TableTheme): TableStyle {
  const headerOn = contrastText(theme.primary);
  switch (name) {
    case 'zebra':
      return {
        name, label: 'Zebra',
        description: 'Alternating pale rows, no borders.',
        headerBackground: theme.background,
        headerText: theme.text,
        border: 'none',
        rowAlternate: theme.tableRowAlternate || lighten(theme.primary, 0.94),
        borderPt: 0,
      };
    case 'boxed':
      return {
        name, label: 'Boxed',
        description: 'A full border and a neutral header.',
        headerBackground: lighten(theme.text, 0.9),
        headerText: theme.text,
        border: theme.tableBorder || darken(theme.text, 0.2),
        rowAlternate: null,
        borderPt: 0.75,
      };
    case 'brand':
      return {
        name, label: 'Brand',
        description: 'The brand colour in the header, with white text.',
        headerBackground: theme.primary,
        headerText: headerOn,
        border: alphaOver(theme.primary, theme.background, 0.35),
        rowAlternate: null,
        borderPt: 0.5,
      };
    case 'muted':
      return {
        name, label: 'Muted',
        description: 'A pale header and no borders.',
        headerBackground: alphaOver(theme.primary, theme.background, 0.12),
        headerText: theme.text,
        border: 'none',
        rowAlternate: null,
        borderPt: 0,
      };
    case 'bold':
      return {
        name, label: 'Bold',
        description: 'A dark header and a heavier border.',
        headerBackground: darken(theme.primary, 0.35),
        headerText: contrastText(darken(theme.primary, 0.35)),
        border: darken(theme.primary, 0.5),
        rowAlternate: null,
        borderPt: 1.5,
      };
    case 'plain':
    default:
      return {
        name: 'plain', label: 'Plain',
        description: 'No fills, hairline rules only.',
        headerBackground: theme.background,
        headerText: theme.text,
        border: 'none',
        rowAlternate: null,
        borderPt: 0.5,
      };
  }
}

/** Every style, in the order the picker shows them. */
export function allTableStyles(theme: TableTheme): TableStyle[] {
  return TABLE_STYLE_NAMES.map((n) => tableStyle(n, theme));
}

/**
 * Resolve the style for one table. A table the format does not name uses the format's default style,
 * so every table has a defined look without the designer touching it.
 */
export function resolveTableStyle(
  theme: TableTheme, choices: { key: string; style: TableStyleName }[], key: string, fallback: TableStyleName,
): TableStyle {
  const chosen = choices.find((c) => c.key === key)?.style ?? fallback;
  return tableStyle(isTableStyleName(chosen) ? chosen : fallback, theme);
}
