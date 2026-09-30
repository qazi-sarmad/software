import React, { useState, useMemo } from 'react';
import { WorkingPaper } from '../../types';
import { drawSeededSample } from '../../lib/auditEngines';
import { Hash, Check, Sliders, ShieldCheck } from '../common/Icons';

interface SamplingTabProps {
  workpaper: WorkingPaper;
}

export const SamplingTab: React.FC<SamplingTabProps> = ({ workpaper }) => {
  const [seed, setSeed] = useState(workpaper.samplingSeed || 'PROVIO-AUDIT-2026-SEED');
  const [sampleSize, setSampleSize] = useState(workpaper.sampleCount || 25);
  const [confidenceLevel, setConfidenceLevel] = useState(95);

  // Generate deterministic synthetic population based on workpaper count
  const dummyPopulation = useMemo(() => {
    const items = [];
    const count = Math.min(workpaper.populationCount || 500, 500);
    for (let i = 1; i <= count; i++) {
      items.push({
        id: `TXN-${100000 + i}`,
        amount: Math.round(1500 + ((i * 37) % 85000)),
        account: `GL-41${(i % 12).toString().padStart(2, '0')}`,
        date: `2026-08-${((i % 28) + 1).toString().padStart(2, '0')}`,
      });
    }
    return items;
  }, [workpaper.populationCount]);

  // Deterministic Mulberry32 selection (LAW 1)
  const sampledItems = useMemo(() => {
    return drawSeededSample(dummyPopulation, sampleSize, seed);
  }, [dummyPopulation, sampleSize, seed]);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <Sliders className="w-4 h-4 text-verdigris" />
          <span>Deterministic Audit Sampling Engine (⚖ Law 1: Zero Math.random)</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Samples are deterministically selected using the Mulberry32 PRNG initialized with an audit seed string. Identical seeds yield identical sample sets anywhere, anytime.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-hairline space-y-1">
          <label className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
            Deterministic Seed String
          </label>
          <input
            type="text"
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            disabled={workpaper.sealed}
            className="w-full font-mono text-apple-12 p-2 rounded-lg bg-surface-sunken border border-hairline text-primary"
          />
        </div>
        <div className="p-4 rounded-xl bg-surface border border-hairline space-y-1">
          <label className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
            Sample Size (n)
          </label>
          <input
            type="number"
            min={1}
            max={dummyPopulation.length}
            value={sampleSize}
            onChange={(e) => setSampleSize(Math.max(1, Number(e.target.value)))}
            disabled={workpaper.sealed}
            className="w-full text-apple-13 p-2 rounded-lg bg-surface-sunken border border-hairline text-primary"
          />
        </div>
        <div className="p-4 rounded-xl bg-surface border border-hairline space-y-1">
          <label className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
            Statistical Confidence Level
          </label>
          <select
            value={confidenceLevel}
            onChange={(e) => setConfidenceLevel(Number(e.target.value))}
            disabled={workpaper.sealed}
            className="w-full text-apple-13 p-2 rounded-lg bg-surface-sunken border border-hairline text-primary"
          >
            <option value={90}>90% (Low Risk Tolerable Deviation)</option>
            <option value={95}>95% (AICPA Standard Assurance)</option>
            <option value={99}>99% (High Inherent Risk / SOX)</option>
          </select>
        </div>
      </div>

      {/* Selected Sample Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Seeded Sample Draw ({sampledItems.length} records)
          </h3>
          <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Deterministically Reproducible
          </span>
        </div>
        <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
          <table className="w-full text-left border-collapse text-apple-12">
            <thead>
              <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                <th className="p-3 font-medium">Ref #</th>
                <th className="p-3 font-medium">Posting Date</th>
                <th className="p-3 font-medium">Account Code</th>
                <th className="p-3 font-medium text-right">Sample Amount (Brass)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sampledItems.map((item, idx) => (
                <tr key={idx} className="hover:bg-surface-hover transition-colors font-mono">
                  <td className="p-3 text-secondary">{item.id}</td>
                  <td className="p-3 text-secondary">{item.date}</td>
                  <td className="p-3 text-primary">{item.account}</td>
                  <td className="p-3 text-right text-primary font-serif-numeral font-bold">
                    ${item.amount.toLocaleString()}
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
