import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { GitCommit, ShieldCheck, ArrowRight, CheckCircle2, AlertTriangle, Layers } from './Icons';

export const RedThreadModal: React.FC = () => {
  const { inspector, closeInspector } = useApp();
  const { scopedWorkpapers, scopedEngagements, scopedObservations, scopedIssues, scopedCapItems } = useScopedData();

  const obs = inspector.data?.observation || scopedObservations[0];
  const wp = obs ? scopedWorkpapers.find((w) => w.id === obs.workpaperId) : null;
  const eng = wp ? scopedEngagements.find((e) => e.id === wp.engagementId) : null;
  const iss = obs ? scopedIssues.find((i) => i.observationId === obs.id) : null;
  const cap = iss ? scopedCapItems.find((c) => c.title.toLowerCase().includes(iss.title.toLowerCase().slice(0, 10))) : null;

  const lineageNodes = [
    {
      stage: '1. Audit Universe & Plan',
      title: eng?.title || 'Global Treasury Assurance',
      ref: eng?.id || 'ENG-2026-001',
      status: 'In Progress',
      color: 'verdigris',
    },
    {
      stage: '2. Working Paper & Test Gate',
      title: wp?.title || 'Intraday Liquidity Buffer Test',
      ref: wp?.refCode || 'WP-TREAS-01',
      status: wp?.sealed ? 'Cryptographically Sealed' : 'Verified Population',
      color: 'verdigris',
    },
    {
      stage: '3. Audit Observation',
      title: obs?.title || 'Delayed Posting in HQLA Buffer',
      ref: obs?.id || 'OBS-2026-001',
      status: `${obs?.severity?.toUpperCase() || 'HIGH'} Severity`,
      color: 'cinnabar',
    },
    {
      stage: '4. Executive Issue Register',
      title: iss?.title || 'Treasury Intraday Cash Pipeline STP Automation',
      ref: iss?.id || 'ISS-2026-001',
      status: iss?.status || 'Management Response',
      color: 'cinnabar',
    },
    {
      stage: '5. Corrective Action Plan (CAP)',
      title: cap?.title || 'Deploy automated SWIFT MT900/910 parser',
      ref: cap?.id || 'CAP-2026-001',
      status: cap?.status || 'Open',
      color: 'amber',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <GitCommit className="w-4 h-4 text-accent" />
          <span>Red Thread — Audit Lineage &amp; Proof Chain</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Unbroken deterministic lineage mapping high-level universe objectives down to atomic test samples and corrective actions.
        </p>
      </div>

      <div className="relative pl-6 space-y-8 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-hairline">
        {lineageNodes.map((node, idx) => (
          <div key={idx} className="relative group">
            <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-surface border-2 border-accent flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-accent" />
            </div>
            <div className="p-4 rounded-xl bg-surface border border-hairline shadow-soft space-y-2 group-hover:bg-surface-hover transition-colors">
              <div className="flex items-center justify-between text-apple-11">
                <span className="text-secondary font-medium uppercase tracking-wider">{node.stage}</span>
                <span className="font-mono text-tertiary">{node.ref}</span>
              </div>
              <div className="text-apple-15 font-semibold text-primary">{node.title}</div>
              <div className="flex items-center gap-2 text-apple-12">
                <span className={`px-2 py-0.5 rounded text-apple-11 font-medium bg-${node.color}-subtle text-${node.color}`}>
                  {node.status}
                </span>
                <span className="text-secondary">• Deterministically Attested</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-hairline flex justify-end">
        <button
          type="button"
          onClick={closeInspector}
          className="px-4 py-2 text-apple-13 font-medium rounded-lg bg-surface border border-hairline text-primary hover:bg-surface-hover transition-colors"
        >
          Close Lineage
        </button>
      </div>
    </div>
  );
};
