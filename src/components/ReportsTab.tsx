import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { FileBarChart, Download, FileText, ShieldCheck, ArrowRight } from '../common/Icons';

export const ReportsTab: React.FC = () => {
  const { openInspector } = useApp();
  const { stats, scopedEngagements } = useScopedData();

  const reportsList = [
    {
      id: 'rep-exec',
      title: 'Quarterly Audit Committee Assurance Pack',
      description: 'Comprehensive risk overview, open findings count, and CAP remediation status for the board.',
      format: 'PDF Deck',
      action: () => openInspector('account_settings'),
    },
    {
      id: 'rep-ledger',
      title: 'Cryptographic Ledger Verification Attestation',
      description: 'Full sequential hash audit trail from genesis to latest seal, signed by 4-eyes keys.',
      format: 'Cryptographic Attestation',
      action: () => alert('Ledger attestation report downloaded.'),
    },
    {
      id: 'rep-sira',
      title: 'Comprehensive SIRA Risk Heatmap & Universe Index',
      description: 'Breakdown of inherent vs residual risk scores across all business units and entities.',
      format: 'Spreadsheet',
      action: () => alert('SIRA spreadsheet generated.'),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-apple-28 font-serif-title font-bold text-primary">
          Audit Reports & Assurance Packs
        </h1>
        <p className="text-apple-13 text-secondary">
          Export verifiable board packages and cryptographically attested ledger logs.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {reportsList.map((rep) => (
          <div
            key={rep.id}
            onClick={rep.action}
            className="p-6 rounded-2xl bg-surface border border-hairline shadow-apple hover:bg-surface-hover transition-colors cursor-pointer flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-surface-sunken border border-hairline flex items-center justify-center text-primary">
                <FileBarChart className="w-5 h-5 text-verdigris" />
              </div>
              <h3 className="text-apple-15 font-semibold text-primary">{rep.title}</h3>
              <p className="text-apple-12 text-secondary leading-relaxed">{rep.description}</p>
            </div>

            <div className="pt-4 border-t border-hairline flex items-center justify-between text-apple-12 font-medium text-primary">
              <span className="text-secondary">{rep.format}</span>
              <span className="flex items-center gap-1 text-verdigris font-semibold">
                Generate <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
