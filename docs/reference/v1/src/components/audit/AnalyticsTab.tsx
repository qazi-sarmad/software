import React, { useState, useMemo } from 'react';
import { WorkingPaper, AnalyticsRule } from '../../types';
import {
  runVarianceAnalysis,
  runTrialBalanceCheck,
  runAnomalyDetection,
  runGlToTbReconciliation,
  VarianceInputItem,
  TrialBalanceItem,
} from '../../lib/analytics';
import { Activity, AlertTriangle, CheckCircle2, TrendingUp, Sliders, ShieldCheck } from '../common/Icons';

interface AnalyticsTabProps {
  workpaper: WorkingPaper;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ workpaper }) => {
  const [selectedRule, setSelectedRule] = useState<AnalyticsRule>('variance');
  const [thresholdPct, setThresholdPct] = useState(10);
  const [thresholdVal, setThresholdVal] = useState(100000);

  // Synthetic deterministic testing data
  const varianceItems: VarianceInputItem[] = useMemo(
    () => [
      { account: '4010 - Corporate Treasury Revenue', category: 'Revenue', currentPeriod: 14200000, priorPeriod: 12500000, rowRef: 1 },
      { account: '5020 - FX Hedging Derivative Settlements', category: 'Expense', currentPeriod: 8900000, priorPeriod: 6200000, rowRef: 2 },
      { account: '1010 - Central Bank Cash Reserves', category: 'Asset', currentPeriod: 450000000, priorPeriod: 480000000, rowRef: 3 },
      { account: '2010 - Interbank Overnight Repo Borrowing', category: 'Liability', currentPeriod: 125000000, priorPeriod: 98000000, rowRef: 4 },
      { account: '6010 - Clearing & Custody Fees', category: 'Expense', currentPeriod: 1450000, priorPeriod: 1420000, rowRef: 5 },
    ],
    []
  );

  const tbItems: TrialBalanceItem[] = useMemo(
    () => [
      { account: '1000 - Operating Cash', debit: 45200000, credit: 0, rowRef: 10 },
      { account: '1200 - Prime Brokerage Receivables', debit: 18400000, credit: 0, rowRef: 11 },
      { account: '2000 - Repo Repurchase Obligations', debit: 0, credit: 63600000, rowRef: 12 },
    ],
    []
  );

  const anomalyItems = useMemo(
    () => [
      { account: '4010 - Wire Postings', amount: 1540000, rowRef: 20 },
      { account: '4010 - Wire Postings', amount: 1500000, rowRef: 21 },
      { account: '4010 - Wire Postings', amount: 12800000, rowRef: 22 }, // Statistical outlier
      { account: '4010 - Wire Postings', amount: 200000, rowRef: 23 }, // Exact round number anomaly
    ],
    []
  );

  // Deterministic engine runs (LAW 1)
  const results = useMemo(() => {
    switch (selectedRule) {
      case 'variance':
        return runVarianceAnalysis(varianceItems, thresholdPct, thresholdVal);
      case 'tb_check':
        return runTrialBalanceCheck(tbItems).rows;
      case 'anomalies':
        return runAnomalyDetection(anomalyItems);
      case 'gl_to_tb':
        return runGlToTbReconciliation(
          varianceItems.map((v) => ({ account: v.account, amount: v.currentPeriod, rowRef: v.rowRef })),
          varianceItems.map((v) => ({ account: v.account, balance: v.priorPeriod, rowRef: v.rowRef }))
        );
      default:
        return runVarianceAnalysis(varianceItems, thresholdPct, thresholdVal);
    }
  }, [selectedRule, varianceItems, tbItems, anomalyItems, thresholdPct, thresholdVal]);

  const flaggedCount = results.filter((r) => r.flagged).length;

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <Activity className="w-4 h-4 text-verdigris" />
          <span>Deterministic Audit Analytics Engine (⚖ Law 1: Hard-coded Math)</span>
        </div>
        <p className="text-apple-12 text-secondary">
          All financial variance, trial balance checks, and anomaly detection rules are executed locally with deterministic mathematical formulas. Zero AI involvement.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-hairline pb-4">
        {(['variance', 'tb_check', 'anomalies', 'gl_to_tb'] as AnalyticsRule[]).map((rule) => (
          <button
            key={rule}
            type="button"
            onClick={() => setSelectedRule(rule)}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-medium transition-colors ${
              selectedRule === rule
                ? 'bg-surface border border-hairline text-primary font-semibold shadow-soft'
                : 'text-secondary hover:text-primary hover:bg-surface-hover'
            }`}
          >
            {rule === 'variance' && 'Period Variance'}
            {rule === 'tb_check' && 'Trial Balance Balance Check'}
            {rule === 'anomalies' && 'Z-Score & Round Numbers'}
            {rule === 'gl_to_tb' && 'GL to TB Subledger Tie-out'}
          </button>
        ))}
      </div>

      {selectedRule === 'variance' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 rounded-lg bg-surface border border-hairline space-y-1">
            <label className="text-apple-11 font-medium text-secondary uppercase">
              Variance % Threshold (Current vs Prior)
            </label>
            <input
              type="number"
              value={thresholdPct}
              onChange={(e) => setThresholdPct(Number(e.target.value))}
              className="w-full p-2 text-apple-12 rounded bg-surface-sunken border border-hairline text-primary"
            />
          </div>
          <div className="p-3 rounded-lg bg-surface border border-hairline space-y-1">
            <label className="text-apple-11 font-medium text-secondary uppercase">
              Absolute Dollar Threshold ($)
            </label>
            <input
              type="number"
              value={thresholdVal}
              onChange={(e) => setThresholdVal(Number(e.target.value))}
              className="w-full p-2 text-apple-12 rounded bg-surface-sunken border border-hairline text-primary"
            />
          </div>
        </div>
      )}

      {/* Analysis Results Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Analysis Output ({results.length} records • {flaggedCount} flagged)
          </h3>
          <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Deterministic Verification
          </span>
        </div>
        <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
          <table className="w-full text-left border-collapse text-apple-12">
            <thead>
              <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                <th className="p-3 font-medium">Account Description</th>
                <th className="p-3 font-medium text-right">Current Period</th>
                <th className="p-3 font-medium text-right">Prior / Benchmark</th>
                <th className="p-3 font-medium text-right">Variance ($)</th>
                <th className="p-3 font-medium">Flag / Finding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {results.map((row) => (
                <tr
                  key={row.rowIndex}
                  className={`hover:bg-surface-hover transition-colors font-mono ${
                    row.flagged ? 'bg-cinnabar-subtle/20' : ''
                  }`}
                >
                  <td className="p-3 font-sans font-medium text-primary">{row.account}</td>
                  <td className="p-3 text-right text-primary font-bold">
                    ${Math.round(row.currentPeriod).toLocaleString()}
                  </td>
                  <td className="p-3 text-right text-secondary">
                    ${Math.round(row.priorPeriod).toLocaleString()}
                  </td>
                  <td
                    className={`p-3 text-right font-bold ${
                      row.varianceVal < 0 ? 'text-cinnabar' : 'text-primary'
                    }`}
                  >
                    {row.varianceVal >= 0 ? '+' : ''}${Math.round(row.varianceVal).toLocaleString()} ({row.variancePct.toFixed(1)}%)
                  </td>
                  <td className="p-3 font-sans">
                    {row.flagged ? (
                      <span className="inline-flex items-center gap-1 text-cinnabar text-apple-11 font-semibold">
                        <AlertTriangle className="w-3.5 h-3.5" /> {row.flagReason}
                      </span>
                    ) : (
                      <span className="text-verdigris text-apple-11 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
