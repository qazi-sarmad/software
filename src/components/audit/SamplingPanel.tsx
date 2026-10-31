import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  listSamplingRules,
  getSampleSize,
  computeSample,
  lockSample,
  getSample,
  getValueCoverage,
  getSamplePrecision,
  listSampleTestedRows,
  waiveValueCoverage,
  type SamplingRuleRow,
  type SampleMode,
  type SampleRow,
  type ValueCoverage,
  type SamplePrecision,
  type SampleTestedRow,
} from '../../data/sampling';
import { hasRight } from '../../lib/rights';
import { rightReason, rightReasonFor } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { HoldToConfirm } from '../common/HoldToConfirm';
import { ExplainPopout } from '../explain/ExplainPopout';
import { Sliders, Lock, CheckCircle2, Hash, Layers } from '../common/Icons';

const SAMPLING_METHODS = new Set([
  'random',
  'systematic',
  'mus',
  'stratified',
  'high_value',
  'low_value',
  'haphazard',
]);

/**
 * Sampling configuration panel (4I, spec §11.2). Shows the org sampling table, the computed floor, a
 * seed preview for system mode and a paste area with per-row validation for auditor-paste mode. The
 * floor is enforced by the database; a locked sample is immutable.
 */
export const SamplingPanel: React.FC<{ workpaperId: string | null }> = ({ workpaperId }) => {
  const { currentUser } = useApp();
  const [rules, setRules] = useState<SamplingRuleRow[]>([]);
  const [sample, setSample] = useState<SampleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SampleMode>('system');
  const [pasteText, setPasteText] = useState('');
  const [floor, setFloor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState<ValueCoverage | null>(null);
  const [precision, setPrecision] = useState<SamplePrecision | null>(null);
  const [tested, setTested] = useState<SampleTestedRow[]>([]);
  const [waiveReason, setWaiveReason] = useState('');

  const canWrite = hasRight(currentUser, 'perform_work');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!workpaperId) {
      setRules([]);
      setSample(null);
      setCoverage(null);
      setPrecision(null);
      setTested([]);
      setLoading(false);
      return;
    }
    try {
      const [rs, s] = await Promise.all([listSamplingRules(), getSample(workpaperId)]);
      setRules(rs);
      setSample(s);
      if (rs.length > 0) {
        const r = rs[0];
        setFloor(await getSampleSize('', r.controlType, r.frequency, r.popBand, 500));
      }
      if (s) {
        const [cov, prec, rows] = await Promise.all([
          getValueCoverage(s.id),
          getSamplePrecision(s.id),
          listSampleTestedRows(s.id),
        ]);
        setCoverage(cov);
        setPrecision(prec);
        setTested(rows);
      } else {
        setCoverage(null);
        setPrecision(null);
        setTested([]);
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

  // The auditor pastes row references, one per line. The database reads `x.item ->> 'row_ref'`, so a
  // bare number is refused; the payload must be `{row_ref}` objects. Non-integer lines are reported
  // rather than sent, so a paste of a spreadsheet column that carries a header is not silently wrong.
  const parsedPaste = pasteText
    .split(/\r?\n/)
    .map((l, i) => ({ line: i + 1, text: l.trim() }))
    .filter((l) => l.text.length > 0);
  const pasteItems: { row_ref: number }[] = [];
  const pasteBadLines: number[] = [];
  for (const l of parsedPaste) {
    const n = Number(l.text);
    if (Number.isInteger(n) && n > 0) pasteItems.push({ row_ref: n });
    else pasteBadLines.push(l.line);
  }

  const run = async () => {
    if (!workpaperId) return;
    setBusy(true);
    setError(null);
    const items = mode === 'auditor_paste' ? pasteItems : undefined;
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

  const waive = async (rowRef: number) => {
    if (!sample) return;
    setBusy(true);
    setError(null);
    const res = await waiveValueCoverage(sample.id, rowRef, waiveReason.trim());
    if (!res.ok) setError(res.reason);
    else {
      setWaiveReason('');
      await load();
    }
    setBusy(false);
  };

  if (loading) {
    return <div className="h-24 rounded-2xl bg-surface-sunken border border-hairline animate-pulse" data-testid="sampling-loading" />;
  }

  if (!workpaperId) {
    return (
      <div className="space-y-5" data-testid="sampling-panel">
        <div className="p-6 text-center text-apple-12 text-secondary bg-surface-elevated rounded-xl" data-testid="sampling-no-workpaper">
          A sample is drawn against a working paper. This engagement has no working paper yet — create
          one in the Testing workspace to enable sampling.
        </div>
      </div>
    );
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
              {pasteItems.length} item{pasteItems.length === 1 ? '' : 's'} parsed
              {pasteBadLines.length > 0 && (
                <span className="text-critical" data-testid="sampling-paste-invalid">
                  {' '}· {pasteBadLines.length} line{pasteBadLines.length === 1 ? '' : 's'} not a row
                  number ({pasteBadLines.slice(0, 5).join(', ')}{pasteBadLines.length > 5 ? '…' : ''})
                </span>
              )}
            </div>
            {floor !== null && pasteItems.length > 0 && (
              <div
                className={`text-apple-11 ${pasteItems.length >= floor ? 'text-verdigris' : 'text-secondary'}`}
                data-testid="sampling-paste-floor"
              >
                {pasteItems.length >= floor
                  ? `Meets the floor of ${floor}.`
                  : `${floor - pasteItems.length} more item(s) needed to reach the floor of ${floor}. A short paste is kept as-is; the floor is enforced when the sample is locked.`}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          data-testid="sampling-compute"
          onClick={run}
          disabled={busy || !canWrite || (mode === 'auditor_paste' && pasteItems.length === 0)}
          title={!canWrite ? rightReason('perform_work') : undefined}
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
              <HoldToConfirm
                label="Lock sample"
                testId="sampling-lock"
                durationMs={2000}
                onConfirm={lock}
                disabled={busy || !canWrite}
                className="relative overflow-hidden px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" /> Lock sample
              </HoldToConfirm>
            )}
          </div>
          {sample.method && (
            <div className="text-apple-11 text-secondary" data-testid="sampling-method">
              Method:{' '}
              {SAMPLING_METHODS.has(sample.method) ? (
                <ExplainPopout explainId={`method.${sample.method}`} screenId="AF-06" element={`explain-method-${sample.method}`}>
                  <span className="text-primary font-semibold capitalize">{sample.method.replace('_', ' ')}</span>
                </ExplainPopout>
              ) : (
                <span className="text-primary font-semibold capitalize">{sample.method.replace('_', ' ')}</span>
              )}
            </div>
          )}
          {sample.calculation && (
            <div className="text-apple-11 text-secondary" data-testid="sampling-calculation">
              How this was calculated: <span className="text-primary">{sample.calculation.formula}</span>
            </div>
          )}
          <div className="text-apple-11 text-tertiary font-mono break-all">seed: {sample.seed}</div>

          {coverage && coverage.highValueRows.length > 0 && (
            <div className="border-t border-hairline pt-3 space-y-2" data-testid="sampling-coverage">
              <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                <ExplainPopout explainId="term.coverage" screenId="AF-06" element="explain-coverage">
                  High-value coverage
                </ExplainPopout>
              </div>
              <div className={`text-apple-12 ${coverage.covered ? 'text-verdigris' : 'text-critical'}`} data-testid="sampling-coverage-status">
                {coverage.covered
                  ? `Covered: all ${coverage.highValueRows.length} high-value item(s) are in the sample or waived.`
                  : `${coverage.missing.length} high-value item(s) are neither in the sample nor waived: ${coverage.missing.join(', ')}.`}
              </div>
              {!coverage.covered && canWrite && (
                <div className="space-y-2">
                  <label className="block text-apple-11 text-secondary" htmlFor="sampling-waive-reason">
                    Waive reason (at least 10 characters). A waiver is kept in the ledger.
                  </label>
                  <input
                    id="sampling-waive-reason"
                    data-testid="sampling-waive-reason"
                    value={waiveReason}
                    onChange={(e) => setWaiveReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-sunken border border-hairline text-apple-12 text-primary"
                  />
                  <div className="flex flex-wrap gap-2">
                    {coverage.missing.map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        data-testid={`sampling-waive-${ref}`}
                        onClick={() => waive(ref)}
                        disabled={busy || waiveReason.trim().length < 10}
                        className="px-3 py-1.5 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-12 font-semibold text-primary disabled:opacity-50"
                      >
                        Waive row {ref}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {precision && precision.n > 0 && (
            <div className="border-t border-hairline pt-3 text-apple-11 text-secondary" data-testid="sampling-precision">
              <ExplainPopout explainId="term.exception" screenId="AF-06" element="explain-exception">
                Exceptions
              </ExplainPopout>
              : <span className="text-primary font-semibold tabular-nums">{precision.k}</span> of{' '}
              <span className="text-primary font-semibold tabular-nums">{precision.n}</span> tested.
              {precision.upper !== null && (
                <> Clopper-Pearson {Math.round(precision.confidence * 100)}% interval:{' '}
                  <span className="text-primary font-semibold tabular-nums">
                    {precision.lower?.toFixed(4) ?? '—'} to {precision.upper.toFixed(4)}
                  </span>
                </>
              )}
            </div>
          )}

          {tested.length > 0 && (
            <div className="border-t border-hairline pt-3 space-y-2" data-testid="sampling-tested-rows">
              <div className="text-apple-11 font-semibold text-secondary uppercase tracking-wider">
                Tested rows from this sample ({tested.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tested.map((r) => (
                  <span
                    key={r.id}
                    data-testid={`sampling-tested-row-${r.rowRef}`}
                    className="px-2 py-0.5 rounded-md bg-surface-sunken border border-hairline text-apple-11 text-secondary font-mono"
                  >
                    {r.rowRef}{r.result ? ` · ${r.result}` : ' · open'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
