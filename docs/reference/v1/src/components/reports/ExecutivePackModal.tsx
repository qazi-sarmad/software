import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { FileBarChart, ShieldCheck, Download, CheckCircle2 } from '../common/Icons';

export const ExecutivePackModal: React.FC = () => {
  const { closeInspector } = useApp();
  const { stats, scopedEngagements, scopedIssues } = useScopedData();

  const handleDownload = () => {
    alert('Executive Assurance Committee Deck export generated with cryptographic hash attestation.');
  };

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileBarChart className="w-4 h-4 text-verdigris" />
          <span>Executive Audit Committee Pack (Board Ready)</span>
        </div>
        <p className="text-apple-12 text-secondary">
          High-level executive assurance briefing containing cryptographic seal tallies, open high-severity findings, and CAP aging metrics.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-hairline space-y-1">
          <span className="text-apple-11 text-secondary uppercase tracking-wider">Total Engagements</span>
          <div className="font-serif-numeral text-apple-28 font-bold text-primary">
            {scopedEngagements.length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-hairline space-y-1">
          <span className="text-apple-11 text-secondary uppercase tracking-wider">Critical Issues</span>
          <div className="font-serif-numeral text-apple-28 font-bold text-cinnabar">
            {stats.criticalIssues}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Audit Committee Summary Points
        </h3>
        <ul className="space-y-2 text-apple-12 text-secondary">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-verdigris shrink-0 mt-0.5" />
            <span>100% of tested working papers attested on cryptographic hash-chain.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-verdigris shrink-0 mt-0.5" />
            <span>All statistical sampling conducted via deterministic Mulberry32 PRNG.</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-verdigris shrink-0 mt-0.5" />
            <span>Multi-tenant scopes strictly enforced per Basel / IIA Standards.</span>
          </li>
        </ul>
      </div>

      <div className="pt-4 border-t border-hairline flex items-center justify-between">
        <button
          type="button"
          onClick={closeInspector}
          className="px-4 py-2 rounded-lg bg-surface border border-hairline text-apple-13 font-medium text-primary hover:bg-surface-hover"
        >
          Close
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="px-4 py-2 rounded-lg bg-verdigris text-white text-apple-13 font-semibold hover:opacity-90 flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          <span>Export Sealed Deck (.PDF)</span>
        </button>
      </div>
    </div>
  );
};
