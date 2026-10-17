import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { listAnalysisResults, raiseFinding, type AnalysisResultRow } from '../../data/analytics';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Activity, AlertTriangle, ChevronDown, ChevronRight, Plus, RefreshCw } from '../common/Icons';

/**
 * Analyst engine panel (4I, spec §12). Lists each check with its result count and expands to the
 * row-level results; every flagged row can raise a finding that carries the rule id, params and the
 * row references. The checks themselves are pure functions in src/lib/analyticsEngine.ts.
 */
export const AnalystEnginePanel: React.FC<{ engagementId: string }> = ({ engagementId }) => {
  const { currentUser } = useApp();
  const [results, setResults] = useState<AnalysisResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [raised, setRaised] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const canRaise = hasRight(currentUser, 'perform_work');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResults(await listAnalysisResults(engagementId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load analysis results.');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCheck = useMemo(() => {
    const map = new Map<string, AnalysisResultRow[]>();
    for (const r of results) {
      const list = map.get(r.ruleId) ?? [];
      list.push(r);
      map.set(r.ruleId, list);
    }
    return [...map.entries()];
  }, [results]);

  const raise = async (r: AnalysisResultRow) => {
    setBusy(true);
    setError(null);
    const res = await raiseFinding(engagementId, r.populationId ?? '', r.ruleId, r.params, r.rowRefs);
    if (!res.ok) setError(res.reason);
    else setRaised((prev) => ({ ...prev, [r.id]: true }));
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="analyst-loading" />;
  }

  return (
    <div className="space-y-4" data-testid="analyst-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-3.5 h-3.5" /> Analyst engine checks
        </h3>
        <button type="button" onClick={() => void load()} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover" aria-label="Refresh">
          <RefreshCw className="w-4 h-4 stroke-[1.5]" />
        </button>
      </div>

      <InlineError message={error} testId="analyst-error" />

      {byCheck.length === 0 ? (
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="analyst-empty">
          No analyst checks have run for this engagement yet.
        </div>
      ) : (
        <div className="space-y-2">
          {byCheck.map(([checkId, rows]) => {
            const flagged = rows.reduce((n, r) => n + r.rowRefs.length, 0);
            const isOpen = open[checkId];
            return (
              <div key={checkId} className="border border-hairline rounded-xl overflow-hidden bg-surface" data-testid={`analyst-check-${checkId}`}>
                <button
                  type="button"
                  onClick={() => setOpen((p) => ({ ...p, [checkId]: !p[checkId] }))}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-hover transition-colors"
                >
                  <span className="flex items-center gap-2 text-apple-13 font-medium text-primary">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    {checkId.replace(/_/g, ' ')}
                  </span>
                  <span
                    data-testid={`analyst-count-${checkId}`}
                    className={`px-2 py-0.5 rounded text-apple-11 font-semibold border ${
                      flagged > 0 ? 'bg-cinnabar-subtle border-cinnabar text-cinnabar' : 'bg-verdigris-subtle border-verdigris text-verdigris'
                    }`}
                  >
                    {flagged} flagged · {rows.length} result{rows.length === 1 ? '' : 's'}
                  </span>
                </button>
                {isOpen && (
                  <div className="divide-y divide-hairline border-t border-hairline">
                    {rows.map((r) => (
                      <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3" data-testid={`analyst-result-${r.id}`}>
                        <div className="min-w-0 space-y-1">
                          <div className="text-apple-12 text-primary flex items-center gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-cinnabar shrink-0" />
                            {r.rowRefs.length} row{r.rowRefs.length === 1 ? '' : 's'} flagged
                          </div>
                          <div className="text-apple-11 text-tertiary font-mono truncate">
                            rows: {r.rowRefs.slice(0, 20).join(', ')}{r.rowRefs.length > 20 ? '…' : ''}
                          </div>
                          <div className="text-apple-11 text-secondary font-mono truncate">
                            params: {JSON.stringify(r.params)}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`analyst-raise-${r.id}`}
                          onClick={() => raise(r)}
                          disabled={busy || !canRaise || raised[r.id] || !r.populationId}
                          title={!canRaise ? 'You do not hold the perform_work right.' : undefined}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" /> {raised[r.id] ? 'Finding raised' : 'Raise finding'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
