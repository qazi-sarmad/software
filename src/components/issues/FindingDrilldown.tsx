import React, { useEffect, useState } from 'react';
import { getFindingDetail, type FindingDetailRow } from '../../data/observations';
import { InlineError } from '../common/InlineError';

/**
 * The original sealed finding behind a Patterns cluster, node or heat-map cell (F15, WK-10).
 *
 * Read-only: the clustering never changes a finding, so this surface only shows the record the
 * group was built from. The read is RLS-scoped, so a finding outside the caller's org or scope
 * comes back as "not available" rather than a guess.
 */
export const FindingDrilldown: React.FC<{ findingId: string }> = ({ findingId }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [finding, setFinding] = useState<FindingDetailRow | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    getFindingDetail(findingId)
      .then((row) => {
        if (cancelled) return;
        setFinding(row);
        setState(row ? 'ready' : 'missing');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'The finding could not be loaded.');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [findingId]);

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="finding-drilldown-loading">Loading the finding…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="finding-drilldown-error" />;
  }
  if (state === 'missing' || !finding) {
    return (
      <p className="text-apple-12 text-secondary" data-testid="finding-drilldown-unavailable">
        Not available. This finding is outside your scope, or it is no longer recorded.
      </p>
    );
  }

  const fields: Array<[string, string]> = [
    ['Condition', finding.condition],
    ['Risk', finding.risk],
    ['Effect', finding.effect],
    ['Recommendation', finding.recommendation],
  ];

  return (
    <div className="space-y-4" data-testid="finding-drilldown">
      <div>
        <span
          className="text-apple-11 font-semibold text-cinnabar bg-cinnabar-subtle px-2.5 py-1 rounded uppercase"
          data-testid="finding-drilldown-severity"
        >
          {finding.severity ?? 'unrated'} severity
        </span>
        <h3 className="text-apple-20 font-bold text-primary mt-2" data-testid="finding-drilldown-title">
          {finding.title}
        </h3>
        {finding.entityName && (
          <p className="text-apple-12 text-secondary mt-1" data-testid="finding-drilldown-entity">
            {finding.entityName}
          </p>
        )}
      </div>

      <dl className="space-y-3">
        {fields.map(([label, value]) => (
          <div key={label} className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-1">
            <dt className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">{label}</dt>
            <dd className="text-apple-13 text-primary leading-relaxed">
              {value || <span className="text-tertiary italic">not provided</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
