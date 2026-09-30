import React from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { ShieldCheck, Clock, FileText, ArrowRight, CheckCircle2, Lock } from '../common/Icons';

export const AuditFileModal: React.FC = () => {
  const { inspector, openInspector, closeInspector, signOffEngagement } = useApp();
  const { scopedEngagements, scopedWorkpapers, scopedControls } = useScopedData();

  const engagement = inspector.data?.engagement || scopedEngagements[0];
  const workpapers = engagement
    ? scopedWorkpapers.filter((w) => w.engagementId === engagement.id)
    : [];
  const controls = engagement
    ? scopedControls.filter((c) => c.engagementId === engagement.id)
    : [];

  if (!engagement) {
    return <div className="p-6 text-center text-secondary">Engagement record not found.</div>;
  }

  const allSealed = workpapers.length > 0 && workpapers.every((w) => w.sealed);

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-apple-11 px-2 py-0.5 rounded bg-surface border border-hairline text-secondary">
              {engagement.id}
            </span>
            <span className="text-apple-11 font-semibold text-secondary uppercase">
              {engagement.stage} Stage
            </span>
          </div>
          {engagement.status === 'signed_off' && (
            <span className="px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Formally Signed-Off
            </span>
          )}
        </div>
        <h2 className="text-apple-17 font-bold text-primary">{engagement.title}</h2>
        <div className="flex items-center gap-4 text-apple-11 text-secondary">
          <span>Due: {engagement.dueDate}</span>
          <span>•</span>
          <span>{workpapers.length} Working Papers</span>
          <span>•</span>
          <span>{controls.length} Controls Evaluated</span>
        </div>
      </div>

      {/* Working Papers Roster */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
            Assigned Working Papers
          </h3>
          <span className="text-apple-11 text-secondary">
            {workpapers.filter((w) => w.sealed).length} of {workpapers.length} Sealed
          </span>
        </div>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {workpapers.map((wp) => (
            <div
              key={wp.id}
              onClick={() => openInspector('workbench', { workpaperId: wp.id })}
              className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors cursor-pointer"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-apple-11 font-bold text-secondary">{wp.refCode}</span>
                  <span className="text-apple-13 font-medium text-primary truncate">{wp.title}</span>
                  {wp.sealed && (
                    <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Sealed
                    </span>
                  )}
                </div>
                <div className="text-apple-11 text-secondary truncate">
                  Objective: {wp.objective}
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2 pl-3">
                <span className="text-apple-11 text-secondary">Open Paper</span>
                <ArrowRight className="w-3.5 h-3.5 text-secondary" />
              </div>
            </div>
          ))}
          {workpapers.length === 0 && (
            <div className="p-6 text-center text-apple-12 text-secondary">
              No working papers assigned to this engagement yet.
            </div>
          )}
        </div>
      </div>

      {/* Engagement Final Sign-off Gate */}
      <div className="pt-4 border-t border-hairline flex items-center justify-between">
        <div className="text-apple-11 text-secondary">
          {allSealed
            ? 'All papers sealed. Ready for engagement attestation.'
            : 'All working papers must be cryptographically sealed before signing off.'}
        </div>
        {engagement.status !== 'signed_off' && (
          <button
            type="button"
            onClick={() => signOffEngagement(engagement.id)}
            disabled={!allSealed}
            className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-verdigris" />
            <span>Sign-Off Engagement File</span>
          </button>
        )}
      </div>
    </div>
  );
};
