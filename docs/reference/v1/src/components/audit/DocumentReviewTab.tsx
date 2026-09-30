import React, { useState, useMemo } from 'react';
import { WorkingPaper } from '../../types';
import { runDocumentReview, DocumentReviewCheckResult } from '../../lib/analytics';
import { FileText, CheckCircle2, AlertTriangle, ShieldCheck } from '../common/Icons';

interface DocumentReviewTabProps {
  workpaper: WorkingPaper;
}

export const DocumentReviewTab: React.FC<DocumentReviewTabProps> = ({ workpaper }) => {
  const [docText, setDocText] = useState(
    `Section 1. Executive Policy Framework
Global Liquidity Risk Management Policy mandates that all intraday settlements exceeding $10,000,000 USD be posted to the general ledger within 60 minutes of Fedwire notification.

Section 2. Control Execution
[TODO: Insert final operational walkthrough narrative from APAC regional branch]

Approved by: Marcus Vance, Head of Assurance
Date: September 15, 2026`
  );

  const reviewResults = useMemo(() => {
    return runDocumentReview(docText);
  }, [docText]);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileText className="w-4 h-4 text-verdigris" />
          <span>Deterministic Document Review Engine (⚖ Law 1 &amp; Law 2)</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Extracts and inspects policy text for incomplete placeholders, missing attestation signatures, invalid date ranges, and empty section bodies using deterministic AST token rules. No cloud LLM.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
          Policy / Governance Workpaper Text
        </label>
        <textarea
          rows={6}
          value={docText}
          onChange={(e) => setDocText(e.target.value)}
          disabled={workpaper.sealed}
          className="w-full p-3 font-mono text-apple-12 rounded-xl bg-surface border border-hairline text-primary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Automated Governance Checks ({reviewResults.filter((r) => r.passed).length} / {reviewResults.length} Passed)
        </h3>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {reviewResults.map((check, idx) => (
            <div key={idx} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-apple-13 font-semibold text-primary">{check.rule}</span>
                {check.passed ? (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Exception
                  </span>
                )}
              </div>
              <p className="text-apple-12 text-secondary">{check.message}</p>
              {check.findings.length > 0 && (
                <div className="p-3 rounded-lg bg-surface-sunken space-y-1 font-mono text-apple-11 text-cinnabar">
                  {check.findings.map((f, i) => (
                    <div key={i}>• {f}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
