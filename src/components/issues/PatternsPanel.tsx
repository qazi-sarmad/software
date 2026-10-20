import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getPatternSettings, listPatternFindings, savePatternSettings, DEFAULT_PATTERN_SETTINGS,
} from '../../data/patterns';
import { clusterFindings, heatMap, layoutGraph, type PatternCluster, type PatternFinding, type PatternSettings } from '../../lib/patterns';
import { hasRight } from '../../lib/rights';
import { useApp } from '../../context/AppContext';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { AlertTriangle, Network, Settings, TrendingUp } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';
type View = 'clusters' | 'heatmap' | 'graph' | 'settings';

/**
 * WK-10 Patterns and OA-21 pattern settings (F15, S10).
 *
 * Lives in the Issues & CAP Register as a "Patterns" view. The clustering is deterministic TF-IDF
 * over finding text plus shared tags (src/lib/patterns.ts) — there is no AI and no randomness. A
 * cluster or a heat-map cell opens the original sealed finding through the normal record view.
 * Settings (threshold, minimum cluster size, years back, severities, visibility right) are a
 * configuration screen (OA-21) available with edit_config; the DATA needs view_insights.
 */
export const PatternsPanel: React.FC<{ onOpenFinding?: (findingId: string) => void }> = ({ onOpenFinding }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canSee = hasRight(currentUser, 'view_insights');
  const canConfig = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [findings, setFindings] = useState<PatternFinding[]>([]);
  const [settings, setSettings] = useState<PatternSettings>({ ...DEFAULT_PATTERN_SETTINGS });
  const [draft, setDraft] = useState<PatternSettings>({ ...DEFAULT_PATTERN_SETTINGS });
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('clusters');
  const [heatBy, setHeatBy] = useState<'year' | 'category'>('year');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    // A caller with neither right gets the plain notice below, not a server refusal.
    if (!canSee && !canConfig) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      // The settings are an edit_config read. A view_insights-only caller (an Audit Manager) is
      // refused them; that is not an error for the data, so it falls back to the documented defaults.
      try {
        const s = await getPatternSettings(orgId);
        setSettings(s);
        setDraft(s);
      } catch {
        setSettings({ ...DEFAULT_PATTERN_SETTINGS });
        setDraft({ ...DEFAULT_PATTERN_SETTINGS });
      }
      if (canSee) {
        const list = await listPatternFindings(orgId);
        setFindings(list);
      }
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the patterns view.');
      setState('error');
    }
  }, [orgId, canSee, canConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  const clusters: PatternCluster[] = useMemo(
    () => (canSee ? clusterFindings(findings, settings) : []),
    [canSee, findings, settings],
  );
  const graph = useMemo(
    () => (view === 'graph' && canSee ? layoutGraph(findings, clusters) : { nodes: [], edges: [] }),
    [view, canSee, findings, clusters],
  );
  const cells = useMemo(
    () => (view === 'heatmap' && canSee ? heatMap(findings, heatBy) : []),
    [view, canSee, findings, heatBy],
  );
  const clusteredIds = useMemo(() => new Set(clusters.flatMap((c) => c.findingIds)), [clusters]);
  const byId = useMemo(() => new Map(findings.map((f) => [f.findingId, f])), [findings]);

  const save = async () => {
    setBusy(true);
    setResult(null);
    setError('');
    const r = await savePatternSettings(orgId, {
      similarityThreshold: draft.similarityThreshold,
      minClusterSize: draft.minClusterSize,
      yearsBack: draft.yearsBack,
      severities: draft.severities,
      visibilityRight: draft.visibilityRight,
    });
    setBusy(false);
    setResult(r.ok ? { ok: true } : { ok: false, reason: r.reason ?? 'Could not save the pattern settings.' });
    if (r.ok) {
      setSettings(draft);
    } else {
      setError(r.reason ?? 'Could not save the pattern settings.');
    }
  };

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="wk-patterns-loading">Looking for patterns…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="wk-patterns-error" />;
  }
  if (!canSee && !canConfig) {
    return (
      <p className="text-apple-12 text-secondary" data-testid="wk-patterns-denied">
        Patterns need the view insights right. Ask an Org Admin if you need it.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="wk-patterns">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Network className="w-4 h-4 text-accent mt-0.5" />
          <div>
            <h3 className="text-apple-14 font-semibold text-primary">Patterns</h3>
            <p className="text-apple-12 text-secondary">
              Recurring themes across engagements, found by matching finding text and shared tags.
              Every group links back to the original sealed finding.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-hairline bg-surface p-1" role="tablist" aria-label="Patterns view">
          {([
            ['clusters', 'Groups'],
            ['heatmap', 'Heat map'],
            ['graph', 'Graph'],
            ['settings', 'Settings'],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              data-testid={`wk-patterns-tab-${v}`}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold ${
                view === v ? 'bg-surface-hover text-primary' : 'text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <InlineError message={error} testId="wk-patterns-inline-error" />

      {view === 'clusters' && (
        <div className="space-y-3" data-testid="wk-patterns-clusters">
          {clusters.length === 0 ? (
            <p className="text-apple-12 text-tertiary" data-testid="wk-patterns-empty">
              No groups found at this threshold. Lower the threshold in Settings, or add more findings.
            </p>
          ) : (
            clusters.map((c) => (
              <div key={c.id} className="rounded-2xl border border-hairline bg-surface p-4 space-y-2" data-testid={`wk-patterns-cluster-${c.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-apple-13 font-semibold text-primary">
                    {c.findingIds.length} findings · cohesion {c.cohesion}
                  </span>
                  <span className="text-apple-11 text-secondary">{c.severities.join(', ')}</span>
                </div>
                <ul className="divide-y divide-hairline">
                  {c.findingIds.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => onOpenFinding?.(id)}
                        data-testid={`wk-patterns-finding-${id}`}
                        className="w-full text-left py-1.5 text-apple-12 text-primary hover:underline"
                      >
                        {byId.get(id)?.title ?? id}
                        <span className="text-tertiary"> · {byId.get(id)?.entityName ?? 'Unknown entity'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {findings.length > 0 && (
            <p className="text-apple-11 text-tertiary" data-testid="wk-patterns-unclustered">
              {findings.length - clusteredIds.size} finding(s) did not match any group.
            </p>
          )}
        </div>
      )}

      {view === 'heatmap' && (
        <div className="space-y-3" data-testid="wk-patterns-heatmap">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-secondary" />
            <label className="text-apple-12 text-secondary space-y-1">
              <span className="sr-only">Group the heat map by</span>
              <select
                value={heatBy}
                onChange={(e) => setHeatBy(e.target.value as 'year' | 'category')}
                data-testid="wk-patterns-heat-by"
                className="px-2 py-1.5 rounded-lg border border-hairline bg-canvas text-primary text-apple-12"
              >
                <option value="year">By year</option>
                <option value="category">By category</option>
              </select>
            </label>
          </div>
          {cells.length === 0 ? (
            <p className="text-apple-12 text-tertiary" data-testid="wk-patterns-heatmap-empty">No findings to plot.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="wk-patterns-heatmap-cells">
              {cells.map((cell) => (
                <button
                  key={`${cell.entityId ?? ''}|${cell.bucket}`}
                  type="button"
                  onClick={() => cell.findingIds[0] && onOpenFinding?.(cell.findingIds[0])}
                  className="rounded-xl border border-hairline bg-surface p-3 text-left hover:bg-surface-hover transition-colors"
                  data-testid={`wk-patterns-cell-${cell.entityId ?? 'none'}-${cell.bucket}`}
                >
                  <div className="text-apple-12 text-primary">{cell.entityName}</div>
                  <div className="text-apple-11 text-secondary">{cell.bucket}</div>
                  <div className="font-serif-numeral text-apple-20 font-bold text-primary tabular-nums" data-testid={`wk-patterns-cell-count-${cell.entityId ?? 'none'}-${cell.bucket}`}>
                    {cell.count}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'graph' && (
        <div className="rounded-2xl border border-hairline bg-surface p-2" data-testid="wk-patterns-graph">
          {graph.nodes.length === 0 ? (
            <p className="p-4 text-apple-12 text-tertiary" data-testid="wk-patterns-graph-empty">No findings to plot.</p>
          ) : (
            <svg viewBox="0 0 800 600" role="img" aria-label="Finding similarity graph" className="w-full h-auto">
              {graph.edges.map((e, i) => {
                const from = graph.nodes.find((n) => n.id === e.from);
                const to = graph.nodes.find((n) => n.id === e.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={i}
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="currentColor" className="text-hairline"
                    strokeWidth={Math.max(0.5, e.weight * 3)}
                  />
                );
              })}
              {graph.nodes.map((n) => (
                <g
                  key={n.id}
                  data-testid={`wk-patterns-node-${n.id}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${n.label}`}
                  onClick={() => onOpenFinding?.(n.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenFinding?.(n.id); }}
                  className="cursor-pointer focus:outline-none"
                >
                  {/* The group holds ONLY the two centred circles, so its bounding box centre is the
                      node centre: a click at that centre always lands on the hit circle. The visible
                      label is a sibling below, so it neither shifts the box nor swallows a click. */}
                  <circle cx={n.x} cy={n.y} r={16} className="fill-transparent" />
                  <circle cx={n.x} cy={n.y} r={7} className={n.clusterId ? 'fill-accent' : 'fill-secondary'} />
                </g>
              ))}
              {graph.nodes.map((n) => (
                <text
                  key={`label-${n.id}`}
                  x={n.x + 10} y={n.y + 3}
                  className="fill-primary text-[11px] pointer-events-none"
                >
                  {n.label}
                </text>
              ))}
            </svg>
          )}
        </div>
      )}

      {view === 'settings' && (
        <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-patterns-config">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-accent" />
            <h4 className="text-apple-13 font-semibold text-primary">Pattern settings</h4>
          </div>
          {!canConfig ? (
            <p className="text-apple-12 text-secondary" data-testid="oa-patterns-config-readonly">
              Only an Org Admin can change these settings.
            </p>
          ) : (
            <>
              <label className="block text-apple-12 text-secondary space-y-1">
                <span>Similarity threshold ({draft.similarityThreshold.toFixed(2)}, 0.10 to 0.90)</span>
                <input
                  type="range" min={0.10} max={0.90} step={0.05}
                  value={draft.similarityThreshold}
                  onChange={(e) => setDraft({ ...draft, similarityThreshold: Number(e.target.value) })}
                  data-testid="oa-patterns-threshold"
                  className="w-full"
                />
              </label>
              <label className="block text-apple-12 text-secondary space-y-1">
                <span>Minimum findings in a group</span>
                <input
                  type="number" min={2} max={20}
                  value={draft.minClusterSize}
                  onChange={(e) => setDraft({ ...draft, minClusterSize: Number(e.target.value) })}
                  data-testid="oa-patterns-min-size"
                  className="w-32 px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
              <label className="block text-apple-12 text-secondary space-y-1">
                <span>Years back</span>
                <input
                  type="number" min={1} max={25}
                  value={draft.yearsBack}
                  onChange={(e) => setDraft({ ...draft, yearsBack: Number(e.target.value) })}
                  data-testid="oa-patterns-years"
                  className="w-32 px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                />
              </label>
              <label className="block text-apple-12 text-secondary space-y-1">
                <span>Right needed to see patterns</span>
                <select
                  value={draft.visibilityRight}
                  onChange={(e) => setDraft({ ...draft, visibilityRight: e.target.value })}
                  data-testid="oa-patterns-visibility"
                  className="px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
                >
                  <option value="view_insights">view_insights</option>
                  <option value="read_only">read_only</option>
                </select>
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy}
                  data-testid="oa-patterns-save"
                  className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
                {result?.ok && (
                  <span className="text-apple-12 text-accent" data-testid="oa-patterns-result">Settings saved.</span>
                )}
                {result && !result.ok && (
                  <span className="text-apple-12 text-cinnabar" data-testid="oa-patterns-result-error">{result.reason}</span>
                )}
              </div>
              {!canSee && (
                <p className="flex items-center gap-1 text-apple-11 text-secondary">
                  <AlertTriangle className="w-3 h-3" /> You can set the options, but you need the view
                  insights right to see the patterns themselves.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
