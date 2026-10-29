import React from 'react';
import { drillItems, type DrillSource, type DrillTarget } from '../../lib/drilldown';
import { X, ArrowRight } from '../common/Icons';

/**
 * DrilldownPanel (E5, U1; docs/EXPLAIN-LAYER.md §4).
 *
 * The exact filtered records behind a dashboard number. It is a `role="complementary"` panel — the
 * same non-blocking convention as the explain detail and the tutorial drawer — never a modal and
 * never a scrim, so the screen behind it stays usable.
 *
 * It renders only rows the host screen already scoped and filtered (`source`), so it cannot show a
 * record the screen behind it had hidden. Opening a row calls `onOpenRecord`, which the host wires to
 * the existing RecordView / FloatingWindowManager drilldown.
 */
export interface DrilldownPanelProps {
  target: DrillTarget;
  source: DrillSource;
  screenId: string;
  onOpenRecord?: (kind: DrillTarget['kind'], id: string) => void;
  onClose: () => void;
}

export const DrilldownPanel: React.FC<DrilldownPanelProps> = ({
  target,
  source,
  screenId,
  onOpenRecord,
  onClose,
}) => {
  const items = drillItems(target.kind, source, target.department);
  const testId = `${screenId}-drilldown`;

  return (
    <section
      data-testid={testId}
      role="complementary"
      aria-label={`${target.label}: ${items.length} record(s)`}
      data-drill-kind={target.kind}
      className="rounded-2xl border border-hairline bg-surface p-4 space-y-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 data-testid={`${testId}-title`} className="text-apple-13 font-semibold text-primary">
            {target.label}
          </h3>
          <p data-testid={`${testId}-filter`} className="text-apple-11 text-secondary">
            {target.filterSummary}
          </p>
        </div>
        <button
          type="button"
          data-testid={`${testId}-close`}
          onClick={onClose}
          aria-label="Close drilldown"
          className="p-1 rounded-md text-secondary hover:text-primary transition-colors"
        >
          <X className="w-4 h-4 stroke-[1.5]" />
        </button>
      </header>

      {items.length === 0 ? (
        <p data-testid={`${testId}-empty`} className="text-apple-12 text-secondary py-6 text-center">
          No records match this filter right now.
        </p>
      ) : (
        <ul data-testid={`${testId}-list`} className="divide-y divide-hairline max-h-80 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid={`${testId}-row-${item.id}`}
                onClick={() => onOpenRecord?.(target.kind, item.id)}
                disabled={!onOpenRecord}
                className="w-full text-left py-2 flex items-center justify-between gap-3 hover:bg-surface-hover transition-colors rounded-lg px-2 disabled:cursor-default"
              >
                <span className="min-w-0">
                  <span className="block text-apple-12 font-medium text-primary truncate">
                    {item.title}
                  </span>
                  {item.subtitle && (
                    <span className="block text-apple-11 text-secondary truncate">{item.subtitle}</span>
                  )}
                </span>
                <span className="shrink-0 flex items-center gap-2">
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-surface-sunken border border-hairline text-secondary">
                      {item.badge}
                    </span>
                  )}
                  {onOpenRecord && <ArrowRight className="w-3.5 h-3.5 text-tertiary stroke-[1.5]" />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
