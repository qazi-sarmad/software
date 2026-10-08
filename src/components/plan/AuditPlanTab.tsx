import React, { useState } from 'react';
import { useScopedData } from '../../hooks/useScopedData';
import { useApp } from '../../context/AppContext';
import { HoverPreview } from '../common/HoverPreview';
import {
  Folder,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  CheckCircle2,
  Clock,
  ChevronRight,
} from '../common/Icons';

export const AuditPlanTab: React.FC = () => {
  const {
    filteredEngagements,
    scopedControls,
    scopedWorkpapers,
    can,
    currentUser,
  } = useScopedData();
  const {
    selectedEngagementId,
    setSelectedEngagementId,
    setSelectedWorkpaperId,
    signOffEngagement,
    reopenEngagement,
    openInspector,
  } = useApp();

  const [reopenNote, setReopenNote] = useState('');
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const selectedEngagement =
    filteredEngagements.find((e) => e.id === selectedEngagementId) ||
    filteredEngagements[0];

  const engagementControls = selectedEngagement
    ? scopedControls.filter((c) => c.engagementId === selectedEngagement.id)
    : [];

  const engagementWorkpapers = selectedEngagement
    ? scopedWorkpapers.filter((w) => w.engagementId === selectedEngagement.id)
    : [];

  const handleSignOff = async (engId: string) => {
    await signOffEngagement(engId);
  };

  const handleReopenSubmit = async (engId: string) => {
    if (reopenNote.trim().length < 10) {
      alert('Reopening justification must be at least 10 characters.');
      return;
    }
    await reopenEngagement(engId, reopenNote);
    setReopeningId(null);
    setReopenNote('');
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
        <div>
          <h1 className="text-apple-28 font-bold text-primary tracking-tight">Audit Engagements &amp; Plan</h1>
          <p className="text-apple-15 text-secondary mt-1">
            Scoped audit portfolio, testing roadmaps, and reviewer attestation sign-offs
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Engagement List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="text-apple-12 font-semibold text-secondary uppercase tracking-wider px-2">
            Active Engagements ({filteredEngagements.length})
          </div>

          {filteredEngagements.length === 0 ? (
            <div className="p-8 text-center bg-surface border border-hairline rounded-2xl text-secondary text-apple-13">
              No engagements within your scope match the current filter.
            </div>
          ) : (
            filteredEngagements.map((eng) => {
              const isSelected = selectedEngagement?.id === eng.id;
              const isLocked = eng.isLocked;

              const previewData = {
                title: eng.title,
                category: `Stage: ${eng.stage.toUpperCase()}`,
                subtitle: `Progress: ${eng.completionPercent}% • Due: ${eng.dueDate}`,
                status: isLocked ? 'Sealed ✓' : eng.status.replace('_', ' ').toUpperCase(),
                statusType: isLocked ? ('verdigris' as const) : ('neutral' as const),
                owner: eng.leadAuditorId,
                dueDate: eng.dueDate,
                metrics: [
                  { label: 'Start Date', value: eng.periodStart },
                  { label: 'Reviewer', value: eng.reviewerId },
                ],
                hint: 'Click to select and view testing controls',
              };

              return (
                <HoverPreview key={eng.id} content={previewData} className="w-full">
                  <div
                    onClick={() => setSelectedEngagementId(eng.id)}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-surface border-accent shadow-apple'
                        : 'bg-surface hover:bg-surface-hover border-hairline'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-apple-11 font-medium text-secondary uppercase tracking-wider">
                        {eng.stage}
                      </span>
                      <div className="flex items-center gap-2">
                        {isLocked ? (
                          <span className="flex items-center gap-1 text-apple-11 font-semibold text-verdigris bg-verdigris-subtle px-2 py-0.5 rounded border border-verdigris">
                            <Lock className="w-3 h-3 stroke-[1.5]" />
                            <span>Sealed ✓</span>
                          </span>
                        ) : (
                          <span className="text-apple-11 font-medium text-secondary bg-surface-sunken px-2 py-0.5 rounded">
                            {eng.status.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="text-apple-15 font-semibold text-primary">{eng.title}</h3>

                    <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between text-apple-11 text-secondary">
                      <span>Due {eng.dueDate}</span>
                      <span className="tabular-nums font-semibold text-primary">
                        {eng.completionPercent}% Complete
                      </span>
                    </div>
                  </div>
                </HoverPreview>
              );
            })
          )}
        </div>

        {/* Right: Selected Engagement Details, Controls & Workpapers */}
        {selectedEngagement && (
          <div className="lg:col-span-7 bg-surface border border-hairline rounded-2xl p-6 shadow-apple space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-hairline pb-5">
              <div>
                <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
                  Audit Execution Target
                </span>
                <h2 className="text-apple-20 font-bold text-primary mt-1">
                  {selectedEngagement.title}
                </h2>
                <div className="flex flex-wrap items-center gap-4 text-apple-12 text-secondary mt-2">
                  <span>Period: {selectedEngagement.periodStart} → {selectedEngagement.periodEnd}</span>
                  <span>•</span>
                  <span>Due: {selectedEngagement.dueDate}</span>
                </div>
              </div>

              {/* Action Buttons: Sign-off & Reopen */}
              <div className="flex items-center gap-2 shrink-0">
                {!selectedEngagement.isLocked ? (
                  can('sign_off', {
                    leadAuditorId: selectedEngagement.leadAuditorId,
                    preparerId: selectedEngagement.leadAuditorId,
                  }).allowed && (
                    <button
                      onClick={() => handleSignOff(selectedEngagement.id)}
                      className="px-4 py-2 bg-accent text-white font-medium text-apple-12 rounded-xl hover:opacity-90 transition-opacity shadow-xs"
                    >
                      Sign-off &amp; Seal
                    </button>
                  )
                ) : (
                  <div>
                    {reopeningId === selectedEngagement.id ? (
                      <div className="flex flex-col gap-2 p-3 bg-surface-elevated border border-hairline rounded-xl w-72">
                        <textarea
                          value={reopenNote}
                          onChange={(e) => setReopenNote(e.target.value)}
                          placeholder="Reopening justification (min 10 chars)..."
                          className="w-full text-apple-12 p-2 bg-surface border border-hairline rounded-lg text-primary outline-none"
                          rows={2}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setReopeningId(null)}
                            className="px-2.5 py-1 text-apple-11 text-secondary hover:text-primary"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleReopenSubmit(selectedEngagement.id)}
                            className="px-3 py-1 bg-cinnabar text-white font-medium text-apple-11 rounded-lg hover:opacity-90"
                          >
                            Confirm Reopen
                          </button>
                        </div>
                      </div>
                    ) : (
                      can('reopen').allowed && (
                        <button
                          onClick={() => setReopeningId(selectedEngagement.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated hover:bg-surface-hover text-secondary border border-hairline text-apple-12 font-medium rounded-xl transition-colors"
                        >
                          <Unlock className="w-3.5 h-3.5 stroke-[1.5]" />
                          <span>Reopen Engagement</span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Controls in this engagement */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
                  Controls Matrix ({engagementControls.length})
                </h4>
              </div>

              <div className="space-y-3">
                {engagementControls.map((ctrl) => (
                  <div
                    key={ctrl.id}
                    className="p-4 rounded-xl bg-surface-elevated border border-hairline space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-apple-12 font-semibold text-primary">
                        {ctrl.code}
                      </span>
                      <span
                        className={`text-apple-11 font-medium px-2 py-0.5 rounded capitalize ${
                          ctrl.effectiveness === 'effective'
                            ? 'text-verdigris bg-verdigris-subtle'
                            : 'text-cinnabar bg-cinnabar-subtle'
                        }`}
                      >
                        {ctrl.effectiveness.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-apple-13 font-semibold text-primary">{ctrl.title}</div>
                    <p className="text-apple-12 text-secondary">{ctrl.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Workpapers in this engagement */}
            <div className="space-y-4 pt-4 border-t border-hairline">
              <div className="flex items-center justify-between">
                <h4 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
                  Associated Working Papers ({engagementWorkpapers.length})
                </h4>
              </div>

              <div className="space-y-2.5">
                {engagementWorkpapers.map((wp) => (
                  <div
                    key={wp.id}
                    onClick={() => {
                      setSelectedWorkpaperId(wp.id);
                      openInspector('workbench', { workpaperId: wp.id });
                    }}
                    className="p-3.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline cursor-pointer transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-accent stroke-[1.5]" />
                      <div>
                        <div className="text-apple-13 font-medium text-primary">
                          {wp.refCode} • {wp.title}
                        </div>
                        <div className="text-apple-11 text-secondary">
                          {wp.sampleCount} Samples Tested • {wp.exceptionsIdentified} Exceptions
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {wp.sealed && (
                        <span className="text-apple-11 font-medium text-verdigris bg-verdigris-subtle px-2 py-0.5 rounded border border-verdigris">
                          Sealed ✓
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-secondary stroke-[1.5]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
