import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listSamplingRules,
  getSampleSize,
  computeSample,
  lockSample,
  getSample,
  type SamplingRuleRow,
  type SampleMode,
  type SampleRow,
} from '../../data/sampling';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Sliders, Lock, CheckCircle2, Hash, Layers } from '../common/Icons';

/**
 * Sampling configuration panel (4I, spec §11.2). Shows the org sampling table, the computed floor, a
 * seed preview for system mode and a paste area with per-row validation for auditor-paste mode. The
 * floor is enforced by the database; a locked sample is immutable.
 */
export const SamplingPanel: React.FC<{ workpaperId: string }> = ({ workpaperId }) => {
  const { currentUser } = useApp();
  const [rules, setRules] = useState<SamplingRuleRow[]>([]);
  const [sample, setSample] = useState<SampleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SampleMode>('system');
  const [pasteText, setPasteText] = useState('');
  const [floor, setFloor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const canWrite = hasRight(currentUser, 'perform_work');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rs, s] = await Promise.all([listSamplingRules(), getSample(workpaperId)]);
      setRules(rs);
      setSample(s);
      if (rs.length > 0) {
        const r = rs[0];
        setFloor(await getSampleSize('', r.controlType, r.frequency, r.popBand, 500));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the sampling configuration.');
    } finally {
      setLoading(false);
    }
  }, [workpaperId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pastedItems = pasteText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const run = async () => {
    setBusy(true);
    setError(null);
    const items = mode === 'auditor_paste' ? pastedItems : undefined;
    const res = await computeSample(workpaperId, mode, items);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  const lock = async () => {
    if (!sample) return;
    setBusy(true);
    setError(null);
    const res = await lockSample(sample.id);
    if (!res.ok) setError(res.reason);
    else await load();
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="sampling-loading" />;
  }

  const seedPreview = sample?.seed ?? `sha256(population.sha256 || ${workpaperId})`;

  return (
    <div className="space-y-5" data-testid="sampling-panel">
      <InlineError message={error} testId="sampling-error" />

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" /> Org sampling table ({rules.length})
        </h3>
        {rules.length === 0 ? (
          <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="sampling-rules-empty">
            No sampling rules are configured for this organisation. An Org Admin sets them in
            Organisation Settings.
          </div>
        ) : (
          <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
            <table className="w-full text-apple-12">
              <thead className="bg-surface-sunken text-secondary">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Control type</th>
                  <th className="text-left px-3 py-2 font-semibold">Frequency</th>
                  <th className="text-left px-3 py-2 font-semibold">Band</th>
                  <th className="text-left px-3 py-2 font-semibold">Method</th>
                  <th className="text-right px-3 py-2 font-semibold">Base</th>
                  <th className="text-right px-3 py-2 font-semibold">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rules.map((r) => (
                  <tr key={r.id} data-testid={`sampling-rule-${r.id}`}>
                    <td className="px-3 py-2 text-primary">{r.controlType}</td>
                    <td className="px-3 py-2 text-secondary">{r.frequency}</td>
                    <td className="px-3 py-2 text-secondary">{r.popBand}</td>
                    <td className="px-3 py-2 text-primary capitalize">{r.method}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{r.baseSize}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{r.pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {floor !== null && (
          <div className="text-apple-12 text-secondary" data-testid="sampling-floor">
            Minimum sample size (floor) for the first rule: <span className="text-primary font-semibold tabular-nums">{floor}</span>
          </div>
        )}
      </div>

      <div className="p-5 rounded-2xl bg-surface border border-hairline space-y-3">
        <div className="text-apple-13 font-semibold text-primary">Sample selection</div>
        <div className="flex items-center gap-2">
          {(['system', 'auditor_paste'] as SampleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`sampling-mode-${m}`}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold border transition-colors ${
                mode === m ? 'bg-surface-hover border-accent text-primary' : 'bg-surface border-hairline text-secondary'
              }`}
            >
              {m === 'system' ? 'System (seeded)' : 'Auditor paste'}
            </button>
          ))}
        </div>

        {mode === 'system' ? (
          <div className="text-apple-11 text-secondary flex items-center gap-2" data-testid="sampling-seed-preview">
            <Hash className="w-3.5 h-3.5" /> Seed preview: <span className="font-mono text-primary break-all">{seedPreview}</span>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-apple-11 text-secondary" htmlFor="sampling-paste">
              Paste one item per line. Items not found in the verified population are rejected.
            </label>
            <textarea
              id="sampling-paste"
              data-testid="sampling-paste"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary font-mono"
            />
            <div className="text-apple-11 text-secondary tabular-nums" data-testid="sampling-paste-count">
              {pastedItems.length} item{pastedItems.length === 1 ? '' : 's'} parsed
            </div>
          </div>
        )}

        <button
          type="button"
          data-testid="sampling-compute"
          onClick={run}
          disabled={busy || !canWrite || (mode === 'auditor_paste' && pastedItems.length === 0)}
          title={!canWrite ? 'You do not hold the perform_work right.' : undefined}
          className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
        >
          <Sliders className="w-3.5 h-3.5" /> Compute sample
        </button>
      </div>

      {sample && (
        <div className="p-5 rounded-2xl bg-surface-elevated border border-hairline space-y-3" data-testid="sampling-current">
          <div className="flex items-center justify-between">
            <div className="text-apple-13 font-semibold text-primary">
              Current sample ({sample.sampleRows.length} rows, floor {sample.sizeFloor ?? '—'})
            </div>
            {sample.lockedAt ? (
              <span className="text-apple-11 font-semibold text-verdigris flex items-center gap-1" data-testid="sampling-locked">
                <CheckCircle2 className="w-3.5 h-3.5" /> Locked
              </span>
            ) : (
              <button
                type="button"
                data-testid="sampling-lock"
                onClick={lock}
                disabled={busy || !canWrite}
                className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" /> Lock sample
              </button>
            )}
          </div>
          <div className="text-apple-11 text-tertiary font-mono break-all">seed: {sample.seed}</div>
        </div>
      )}
    </div>
  );
};
