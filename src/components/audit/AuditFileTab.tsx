import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { Folder } from '../common/Icons';

/**
 * Audit File tab (Guide v7 §5.6). Stub: the full workspace is rebuilt in a later batch.
 * Until then it opens the existing Audit File inspector for the selected engagement.
 */
export const AuditFileTab: React.FC = () => {
  const { openInspector, selectedEngagementId } = useApp();
  const { scopedEngagements } = useScopedData();
  const engagement =
    scopedEngagements.find((e) => e.id === selectedEngagementId) || scopedEngagements[0];

  return (
    <section
      data-testid="tab-audit-file"
      className="max-w-7xl mx-auto px-6 py-8 min-h-[60vh] flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 text-secondary text-apple-12 font-medium uppercase tracking-wider">
        <Folder className="w-4 h-4 stroke-[1.3]" />
        <span>Coming online</span>
      </div>
      <h1 className="font-serif-title text-apple-28 font-bold text-primary tracking-tight">
        Audit File
      </h1>
      <p className="text-apple-15 text-secondary max-w-2xl">
        One engagement at a time: planning, testing, findings, evidence, comments, ledger and report.
      </p>
      {engagement ? (
        <div>
          <button
            type="button"
            onClick={() => openInspector('audit_file', { engagement })}
            className="mt-2 px-4 py-2 rounded-xl bg-primary text-canvas text-apple-13 font-semibold hover:opacity-90 transition-opacity"
          >
            Open {engagement.title}
          </button>
        </div>
      ) : (
        <p className="text-apple-13 text-tertiary">No engagements available in your scope.</p>
      )}
    </section>
  );
};
