/**
 * W4.3: the Lineage panel. Every figure in every output and screen has a "Show source data" control
 * that opens this panel. It shows the plain-words description of the computation, its parameters, the
 * list of source records with drill-through to each record (respecting the viewer's rights and
 * scope, with "Not available" for out-of-scope records), the row count, the stored value and the
 * recomputed value side by side, and the lineage hash. The record list exports as CSV with the
 * lineage hash on every row.
 */

import type { FigureFunction, FigureLineage } from './figures';

export interface LineagePanelRecord {
  type: string;
  id: string;
  /** The content hash, or 'not available' when the viewer may not see the record. */
  contentHash: string;
  /** False when the record is out of the viewer's scope; the drill-through is then disabled. */
  available: boolean;
}

export interface LineagePanelView {
  figureId: string;
  figureVersion: number;
  description: string;
  inputs: Array<{ table: string; column: string }>;
  parameters: Record<string, string | number | boolean | null>;
  records: LineagePanelRecord[];
  rowCount: number;
  storedValue: string;
  recomputedValue: string;
  lineageHash: string;
  timeArgument: string;
}

/**
 * Build the panel view. `inScope`, when given, is the set of record ids the viewer may see; every
 * other record shows as "Not available" and its hash is withheld.
 */
export function lineagePanel(fn: FigureFunction, lineage: FigureLineage, recomputedValue: string,
  inScope?: Set<string>): LineagePanelView {
  const records: LineagePanelRecord[] = lineage.records.map((r) => {
    const available = inScope ? inScope.has(r.id) : true;
    return {
      type: r.type,
      id: r.id,
      contentHash: available ? r.contentHash : 'not available',
      available,
    };
  });
  return {
    figureId: lineage.figureId,
    figureVersion: lineage.figureVersion,
    description: fn.description,
    inputs: fn.inputs,
    parameters: lineage.parameters,
    records,
    rowCount: lineage.rowCount,
    storedValue: lineage.result,
    recomputedValue,
    lineageHash: lineage.lineageHash,
    timeArgument: lineage.timeArgument,
  };
}

/** The record list as CSV, with the lineage hash on every row. */
export function lineageCsv(lineage: FigureLineage): string {
  const header = 'figure_id,figure_version,record_type,record_id,content_hash,lineage_hash';
  const rows = lineage.records.map((r) =>
    [lineage.figureId, lineage.figureVersion, r.type, r.id, r.contentHash, lineage.lineageHash]
      .map(csvField).join(','));
  return [header, ...rows].join('\n') + '\n';
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * W4.3: the exported report bundle carries the lineage for every figure so a third party can see it
 * too. This is the bundle's lineage section: one panel view per figure, in claim order.
 */
export function bundleLineage(views: LineagePanelView[]): string {
  return JSON.stringify(views.map((v) => ({
    figureId: v.figureId,
    figureVersion: v.figureVersion,
    description: v.description,
    parameters: v.parameters,
    records: v.records,
    rowCount: v.rowCount,
    storedValue: v.storedValue,
    lineageHash: v.lineageHash,
  })), null, 0);
}
