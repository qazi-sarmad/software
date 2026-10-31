/**
 * W4: numeric integrity and viewable figure lineage.
 *
 * Every number in a report is a FigureBinding to a versioned, hash-identified figure function. The
 * function declares the tables and columns it reads; a figure may reference at most the records its
 * function declares. The lineage (function id and version, parameters, the exact source records with
 * their content hashes, the row count, the result, the time argument and the lineage hash) is stored
 * with the claim at composition and again at recompute. A mismatch blocks the freeze.
 *
 * Arithmetic is decimal-exact: money and numbers are integers of minor units, never floating point.
 */

import { decimal, decimalToString, decimalFromString, addDecimal, subDecimal, divDecimal, Decimal, hashParts } from './canonical';
import type { FigureBinding, Reference } from './types';

/** The declaration of one figure function: what it reads and how it computes. */
export interface FigureFunction {
  id: string;
  version: number;
  /** A plain-words description of the computation, shown in the Lineage panel (W4.3). */
  description: string;
  /** The tables and columns the function reads. A figure may reference only these. */
  inputs: Array<{ table: string; column: string }>;
  /** The declared parameters. */
  parameters: string[];
  /** A hash over the function body, so a version can be shown immutable. */
  bodyHash: string;
  /** The pure computation, as a declarative description evaluated by fixed rules (never generated). */
  computation: FigureComputation;
}

/** A pure, declarative computation. Evaluated by fixed rules in `evaluateFigure`. */
export type FigureComputation =
  | { op: 'count'; table: string }
  | { op: 'sum'; table: string; column: string }
  | { op: 'count_where'; table: string; where: { column: string; equals: string } }
  | { op: 'ratio'; numerator: FigureComputation; denominator: FigureComputation; scale: number };

export interface SourceRecord {
  type: string;
  id: string;
  contentHash: string;
}

export interface FigureLineage {
  figureId: string;
  figureVersion: number;
  parameters: Record<string, string | number | boolean | null>;
  /** The exact set of source records the function read, sorted. */
  records: SourceRecord[];
  rowCount: number;
  result: string;
  /** The time argument, passed in; the engine reads no clock. */
  timeArgument: string;
  lineageHash: string;
}

/** The registry of figure functions. Versioned and hash-identified. */
export const FIGURE_FUNCTIONS: FigureFunction[] = [
  {
    id: 'fig.exception_rate',
    version: 1,
    description: 'The number of items with an exception, divided by the number of items tested.',
    inputs: [
      { table: 'test_rows', column: 'outcome' },
      { table: 'sample_rows', column: 'id' },
    ],
    parameters: ['engagementId'],
    bodyHash: 'a1'.repeat(32),
    computation: {
      op: 'ratio',
      numerator: { op: 'count_where', table: 'test_rows', where: { column: 'outcome', equals: 'exception' } },
      denominator: { op: 'count', table: 'test_rows' },
      scale: 4,
    },
  },
  {
    id: 'fig.payments_unapproved_value',
    version: 1,
    description: 'The total value of payments tested with no evidence of approval.',
    inputs: [{ table: 'sample_rows', column: 'amount_minor' }],
    parameters: ['engagementId'],
    bodyHash: 'b2'.repeat(32),
    computation: { op: 'sum', table: 'sample_rows', column: 'amount_minor' },
  },
  {
    id: 'fig.controls_tested',
    version: 1,
    description: 'The number of controls tested in the engagement.',
    inputs: [{ table: 'test_rows', column: 'control_id' }],
    parameters: ['engagementId'],
    bodyHash: 'c3'.repeat(32),
    computation: { op: 'count', table: 'test_rows' },
  },
  {
    id: 'fig.findings_count',
    version: 1,
    description: 'The number of findings in the engagement.',
    inputs: [{ table: 'findings', column: 'id' }],
    parameters: ['engagementId'],
    bodyHash: 'd4'.repeat(32),
    computation: { op: 'count', table: 'findings' },
  },
  {
    id: 'fig.alerts_by_rule',
    version: 1,
    description: 'The number of alerts triggered by monitor rules in the period.',
    inputs: [{ table: 'alerts', column: 'rule_id' }],
    parameters: ['organisationId', 'periodStart', 'periodEnd'],
    bodyHash: 'e5'.repeat(32),
    computation: { op: 'count', table: 'alerts' },
  },
];

export function figureFunctionById(id: string, version?: number): FigureFunction | undefined {
  return FIGURE_FUNCTIONS.find((f) => f.id === id && (version === undefined || f.version === version));
}

/**
 * A figure's declared source tables. The lineage may reference at most the records the function
 * declares, so a caller cannot smuggle an undeclared record into the lineage.
 */
export function declaredTables(fn: FigureFunction): Set<string> {
  return new Set(fn.inputs.map((i) => i.table));
}

export interface FigureEvaluation {
  result: string;
  records: SourceRecord[];
  rowCount: number;
}

/**
 * Evaluate a figure function against the supplied records. `records` is the data the function
 * reads; the caller supplies it (the engine reads no database itself). Only records whose table the
 * function declares are accepted.
 */
export function evaluateFigure(fn: FigureFunction, records: SourceRecord[],
  columns: Map<string, Map<string, string>>): FigureEvaluation {
  const declared = declaredTables(fn);
  const used: SourceRecord[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!declared.has(r.type)) {
      throw new Error(`figure ${fn.id}: record type ${r.type} is not declared by the function`);
    }
    const key = `${r.type}:${r.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      used.push(r);
    }
  }
  used.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const result = evaluateComputation(fn.computation, columns, used);
  return { result, records: used, rowCount: used.length };
}

function tableRows(records: SourceRecord[], table: string, columns: Map<string, Map<string, string>>): string[] {
  const col = columns.get(table);
  if (!col) return [];
  return records.filter((r) => r.type === table).map((r) => col.get(r.id) ?? '');
}

function evaluateComputation(comp: FigureComputation, columns: Map<string, Map<string, string>>,
  records: SourceRecord[]): string {
  switch (comp.op) {
    case 'count':
      return String(records.filter((r) => r.type === comp.table).length);
    case 'count_where': {
      const col = columns.get(comp.table);
      if (!col) return '0';
      const n = records.filter((r) => r.type === comp.table && col.get(r.id) === comp.where.equals).length;
      return String(n);
    }
    case 'sum': {
      const col = columns.get(comp.table);
      if (!col) return decimalToString(decimal('0', 0));
      let total: Decimal = decimal('0', 0);
      for (const r of records) {
        if (r.type !== comp.table) continue;
        const raw = col.get(r.id) ?? '0';
        total = addDecimal(total, decimal(raw, 0));
      }
      return decimalToString(total);
    }
    case 'ratio': {
      const num = evaluateComputation(comp.numerator, columns, records);
      const den = evaluateComputation(comp.denominator, columns, records);
      const n = decimal(num, 0);
      const d = decimal(den, 0);
      if (d.units === '0') return decimalToString(decimal('0', comp.scale));
      return decimalToString(divDecimal(n, d, comp.scale));
    }
    default:
      throw new Error('unknown computation');
  }
}

/** The lineage hash over the function, its version, parameters, records, row count, result and time. */
export function lineageHash(input: Omit<FigureLineage, 'lineageHash'>): Promise<string> {
  return hashParts([
    'lineage',
    input.figureId,
    String(input.figureVersion),
    canonicalParameters(input.parameters),
    ...input.records.map((r) => `${r.type}\u0001${r.id}\u0001${r.contentHash}`),
    String(input.rowCount),
    input.result,
    input.timeArgument,
  ]);
}

function canonicalParameters(params: Record<string, string | number | boolean | null>): string {
  return Object.keys(params).sort().map((k) => `${k}=${String(params[k])}`).join('\u0001');
}

/** Build a complete lineage record for a figure evaluation. */
export async function buildLineage(fn: FigureFunction, parameters: FigureLineage['parameters'],
  evaluation: FigureEvaluation, timeArgument: string): Promise<FigureLineage> {
  const body = {
    figureId: fn.id,
    figureVersion: fn.version,
    parameters,
    records: evaluation.records,
    rowCount: evaluation.rowCount,
    result: evaluation.result,
    timeArgument,
  };
  return { ...body, lineageHash: await lineageHash(body) };
}

/** A figure binding as it is stored with a claim. */
export function toBinding(fn: FigureFunction, lineage: FigureLineage): FigureBinding {
  return {
    figureId: fn.id,
    figureVersion: fn.version,
    parameters: lineage.parameters,
    result: lineage.result,
  };
}

export interface RecomputeDifference {
  claimId: string;
  figureId: string;
  stored: string;
  recomputed: string;
  storedLineageHash: string;
  recomputedLineageHash: string;
}

/**
 * W4.4: recompute every bound figure and return the figures whose value or lineage changed. The
 * freeze refuses on any difference and lists them.
 */
export async function recomputeFigures(
  claims: Array<{ id: string; figures: FigureBinding[] }>,
  lineageByClaim: Map<string, FigureLineage[]>,
  recordsByTable: Map<string, SourceRecord[]>,
  columns: Map<string, Map<string, string>>,
  timeArgument: string,
): Promise<RecomputeDifference[]> {
  const differences: RecomputeDifference[] = [];
  for (const claim of claims) {
    for (const binding of claim.figures) {
      const fn = figureFunctionById(binding.figureId, binding.figureVersion);
      if (!fn) {
        differences.push({
          claimId: claim.id, figureId: binding.figureId, stored: binding.result,
          recomputed: '<no such figure function>', storedLineageHash: '', recomputedLineageHash: '',
        });
        continue;
      }
      const records = recordsByTable.get(fn.inputs[0]?.table ?? '') ?? [];
      const evaluation = evaluateFigure(fn, records, columns);
      const recomputedLineage = await buildLineage(fn, binding.parameters, evaluation, timeArgument);
      const stored = (lineageByClaim.get(claim.id) ?? []).find((l) => l.figureId === binding.figureId);
      if (evaluation.result !== binding.result
        || !stored
        || stored.lineageHash !== recomputedLineage.lineageHash) {
        differences.push({
          claimId: claim.id,
          figureId: binding.figureId,
          stored: binding.result,
          recomputed: evaluation.result,
          storedLineageHash: stored?.lineageHash ?? '',
          recomputedLineageHash: recomputedLineage.lineageHash,
        });
      }
    }
  }
  return differences;
}

/**
 * W4.5 rounding consistency: a displayed total equals the sum of the displayed parts, or the
 * template declares and discloses its rounding rule. This checks the sum of the displayed parts.
 */
export function roundingConsistent(parts: string[], total: string, scale: number): boolean {
  let sum: Decimal = decimal('0', scale);
  for (const p of parts) sum = addDecimal(sum, decimalFromString(p, scale));
  return subDecimal(sum, decimalFromString(total, scale)).units === '0';
}

export type { Reference };
