import React, { useMemo } from 'react';
import { AGE_BUCKETS, SEVERITY_ORDER, buildHeatMatrix } from '../../lib/issueHeat';
import type { AuditIssue, Severity } from '../../types';

/**
 * The issues heat matrix (WP-V slice 1). A severity × aging grid drawn beside the register table so
 * the eye finds the hot corner — critical and old — without reading every row. It is a picture of the
 * same issues the table lists; a cell click filters the register to that severity.
 *
 * All colour comes from design tokens: the cell tint is the accent's opacity as an inline style,
 * never a colour literal.
 */
export interface IssueHeatMatrixProps {
  issues: AuditIssue[];
  /** The as-of day, passed in (never read from the clock inside the matrix). */
  asOf: string;
  /** Called when a severity row label is clicked, to filter the register. */
  onPickSeverity?: (severity: Severity) => void;
  prefix?: string;
}

const severityLabel = (s: Severity) => s.charAt(0).toUpperCase() + s.slice(1);

export const IssueHeatMatrix: React.FC<IssueHeatMatrixProps> = ({ issues, asOf, onPickSeverity, prefix = 'issues-heat' }) => {
  const matrix = useMemo(() => buildHeatMatrix(issues, asOf), [issues, asOf]);

  const cellFor = (severity: Severity, bucket: string) =>
    matrix.cells.find((c) => c.severity === severity && c.bucket === bucket)!;

  const tint = (count: number, overdue: boolean): { background: string; opacity: number } => {
    if (count === 0) return { background: 'transparent', opacity: 0 };
    const ratio = matrix.max > 0 ? count / matrix.max : 0;
    return {
      background: overdue ? 'var(--accent-cinnabar)' : 'var(--accent-verdigris)',
      opacity: 0.18 + ratio * 0.62,
    };
  };

  return (
    <section className="bg-surface border border-hairline rounded-2xl shadow-apple p-4 space-y-3" data-testid={`${prefix}-section`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-apple-15 font-semibold text-primary">Issue heat: severity by age</h2>
        <span className="text-apple-11 text-secondary" data-testid={`${prefix}-summary`}>
          {matrix.total} open issue{matrix.total === 1 ? '' : 's'} as at {asOf}
        </span>
      </div>

      {matrix.total === 0 ? (
        <div className="py-6 text-center text-apple-12 text-secondary" data-testid={`${prefix}-empty`}>
          No open issues in the current scope — nothing is aging.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-apple-11" data-testid={`${prefix}-grid`}>
            <thead>
              <tr>
                <th className="text-left text-secondary font-medium pr-2">Severity</th>
                {AGE_BUCKETS.map((b) => (
                  <th key={b.key} className="text-center text-secondary font-medium" data-testid={`${prefix}-col-${b.key}`}>{b.label}</th>
                ))}
                <th className="text-center text-secondary font-medium pl-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {SEVERITY_ORDER.map((sev) => (
                <tr key={sev}>
                  <th scope="row" className="text-left font-medium text-primary pr-2">
                    {onPickSeverity ? (
                      <button type="button" className="underline decoration-hairline" data-testid={`${prefix}-row-${sev}`}
                        onClick={() => onPickSeverity(sev)}>{severityLabel(sev)}</button>
                    ) : (
                      <span data-testid={`${prefix}-row-${sev}`}>{severityLabel(sev)}</span>
                    )}
                  </th>
                  {AGE_BUCKETS.map((b) => {
                    const cell = cellFor(sev, b.key);
                    const t = tint(cell.count, cell.overdue);
                    return (
                      <td key={b.key} className="text-center" data-testid={`${prefix}-cell-${sev}-${b.key}`}
                        data-count={cell.count} data-overdue={cell.overdue ? 'true' : 'false'}>
                        <div className="rounded-md h-8 relative flex items-center justify-center text-primary font-semibold">
                          {cell.count > 0 && (
                            <span className="absolute inset-0 rounded-md" style={{ background: t.background, opacity: t.opacity }} />
                          )}
                          <span className="relative">{cell.count > 0 ? cell.count : ''}</span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-center text-primary font-semibold pl-2" data-testid={`${prefix}-row-total-${sev}`}>
                    {matrix.rowTotals[sev]}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="text-left text-secondary font-medium pr-2">Total</th>
                {AGE_BUCKETS.map((b) => (
                  <td key={b.key} className="text-center text-secondary font-semibold" data-testid={`${prefix}-col-total-${b.key}`}>
                    {matrix.columnTotals[b.key]}
                  </td>
                ))}
                <td className="text-center text-primary font-semibold pl-2" data-testid={`${prefix}-grand-total`}>{matrix.total}</td>
              </tr>
            </tbody>
          </table>
          <div className="text-apple-11 text-secondary mt-2" data-testid={`${prefix}-legend`}>
            A cinnabar cell holds an overdue issue. Age is counted from the date the issue was raised.
          </div>
        </div>
      )}
    </section>
  );
};
