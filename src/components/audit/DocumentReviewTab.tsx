import React, { useState, useMemo } from 'react';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { runDocumentReview, DocumentReviewCheckResult } from '../../lib/analytics';
import { runStructuralReview, type DocCheckResult } from '../../lib/documentReview';
import { FileText, CheckCircle2, AlertTriangle, ShieldCheck } from '../common/Icons';

interface DocumentReviewTabProps {
  workpaper: WorkingPaper;
}

/** The text checks and the structural checks share a shape; the tab renders both. */
interface ReviewRow {
  rule: string;
  passed: boolean;
  message: string;
  findings: string[];
}

function toRows(checks: Array<DocumentReviewCheckResult | DocCheckResult>): ReviewRow[] {
  return checks.map((c) => ({
    rule: c.rule,
    passed: c.passed,
    message: c.message,
    findings: (c.findings as Array<string | { where: string; detail: string }>).map((f) =>
      typeof f === 'string' ? f : `${f.where}: ${f.detail}`),
  }));
}

export const DocumentReviewTab: React.FC<DocumentReviewTabProps> = ({ workpaper }) => {
  // Starting text comes from the tenant seed (empty outside the demo tenant).
  const { documentSample } = useApp();
  const [docText, setDocText] = useState(documentSample);

  const reviewResults = useMemo(() => {
    // §13.1: the text checks (placeholders, signatures, dates, empty sections) and the structural
    // checks (cross-footing, numeric consistency, template conformance) always run together.
    return toRows([...runDocumentReview(docText), ...runStructuralReview(docText)]);
  }, [docText]);

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <FileText className="w-4 h-4 text-verdigris" />
          <span>Document Review</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Checks policy text for incomplete placeholders, missing signatures, invalid date ranges and empty sections. Runs locally; no cloud AI.
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
