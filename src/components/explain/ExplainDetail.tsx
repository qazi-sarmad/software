import React from 'react';
import { useExplain } from '../../hooks/useExplain';
import { iiaTitle } from '../../lib/explain/iia';
import type { ExplainContext } from '../../lib/explain/catalogue';

/**
 * The full explain detail panel (docs/EXPLAIN-LAYER.md §2, §5.4; E2, E6, E7).
 *
 * The hover card (`ExplainPopout`) is a glance; this is the full reference: what it is, what it does,
 * how it works, when to use it and when not to, the IIA standards it implements, and the contextual
 * values the host screen filtered. It is a `role="complementary"` panel — non-blocking, never a modal
 * — so it can be shown inline beside a number or inside the sliding inspector.
 */
export interface ExplainDetailProps {
  explainId: string;
  context?: ExplainContext;
  screenId: string;
  className?: string;
}

function Section({ title, items, testId }: { title: string; items: string[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-apple-11 uppercase tracking-wider text-secondary">{title}</h4>
      <ul data-testid={testId} className="space-y-1 text-apple-12 text-primary list-disc list-inside">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export const ExplainDetail: React.FC<ExplainDetailProps> = ({ explainId, context, screenId, className = '' }) => {
  const { view, pinned, togglePin } = useExplain(explainId, context);

  return (
    <section
      data-testid={`${screenId}-explain-detail`}
      role="complementary"
      aria-label={`Explanation: ${view.title}`}
      data-pinned={pinned || undefined}
      className={`space-y-3 rounded-2xl border border-hairline bg-surface p-4 ${className}`}
    >
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-apple-11 uppercase tracking-wider text-secondary">{view.kind}</span>
          <div className="flex items-center gap-2">
            {view.status === 'denied' && (
              <span
                data-testid={`${screenId}-explain-denied`}
                className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar"
              >
                Restricted
              </span>
            )}
            <button
              type="button"
              data-testid={`${screenId}-explain-pin`}
              onClick={togglePin}
              aria-pressed={pinned}
              className="px-2 py-0.5 rounded-full text-apple-11 font-medium border border-hairline text-secondary hover:bg-surface-hover"
            >
              {pinned ? 'Pinned' : 'Pin'}
            </button>
          </div>
        </div>
        <h3 data-testid={`${screenId}-explain-title`} className="text-apple-15 font-semibold text-primary">
          {view.title}
        </h3>
      </header>

      {view.status === 'denied' ? (
        <p data-testid={`${screenId}-explain-denied-reason`} className="text-apple-13 text-secondary">
          {view.deniedReason}
        </p>
      ) : (
        <>
          <p data-testid={`${screenId}-explain-summary`} className="text-apple-13 text-primary">
            {view.summary}
          </p>
          <p data-testid={`${screenId}-explain-effect`} className="text-apple-13 text-secondary">
            {view.effect}
          </p>

          <Section title="Detail" items={view.detail} testId={`${screenId}-explain-detail-list`} />
          <Section title="How it works" items={view.howItWorks} testId={`${screenId}-explain-how`} />
          <Section title="When to use" items={view.whenToUse} testId={`${screenId}-explain-when`} />
          <Section
            title="When not to use"
            items={view.whenNotToUse}
            testId={`${screenId}-explain-when-not`}
          />

          {view.values.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-apple-11 uppercase tracking-wider text-secondary">Values</h4>
              <dl data-testid={`${screenId}-explain-values`} className="grid grid-cols-2 gap-x-3 gap-y-1 text-apple-12">
                {view.values.map((v, i) => (
                  <React.Fragment key={i}>
                    <dt className="text-tertiary">{v.label}</dt>
                    <dd className="text-primary tabular-nums">{v.value}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
          )}

          {view.iiaStandards.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-apple-11 uppercase tracking-wider text-secondary">
                IIA Global Internal Audit Standards (2024)
              </h4>
              <ul data-testid={`${screenId}-explain-standards`} className="space-y-1 text-apple-12">
                {view.iiaStandards.map((n) => (
                  <li key={n} className="flex items-start gap-2">
                    <span className="shrink-0 font-semibold text-primary tabular-nums">{n}</span>
                    <span className="text-secondary">{iiaTitle(n) ?? ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.source && (
            <p data-testid={`${screenId}-explain-source`} className="text-apple-11 text-tertiary">
              Source: {view.source}
            </p>
          )}
        </>
      )}
    </section>
  );
};
