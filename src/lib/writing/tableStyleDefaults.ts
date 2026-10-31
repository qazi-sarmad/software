/** The default table style, and the catalogue of style names, kept in their own module so the theme,
 *  the table catalogue and the format model can all import them without a cycle. Pure data. */
export const TABLE_STYLE_NAMES = ['plain', 'zebra', 'boxed', 'brand', 'muted', 'bold'] as const;
export type TableStyleName = (typeof TABLE_STYLE_NAMES)[number];

export const DEFAULT_TABLE_STYLE: TableStyleName = 'plain';

export const TABLE_STYLE_LABELS: Record<TableStyleName, string> = {
  plain: 'Plain',
  zebra: 'Zebra',
  boxed: 'Boxed',
  brand: 'Brand',
  muted: 'Muted',
  bold: 'Bold',
};
