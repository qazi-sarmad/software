import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { WorkbenchHeader } from './WorkbenchHeader';
import { TestingStepsTab } from './TestingStepsTab';
import { SamplingTab } from './SamplingTab';
import { EvidenceTab } from './EvidenceTab';
import { AnalyticsTab } from './AnalyticsTab';
import { DocumentReviewTab } from './DocumentReviewTab';
import { FindingsTab } from './FindingsTab';
import { getWorkpaperLock } from '../../lib/workpaperLock';
import { ClipboardList, Sliders, FileCheck, Activity, FileText, AlertTriangle } from '../common/Icons';

type WorkbenchSubTab = 'testing' | 'sampling' | 'evidence' | 'analytics' | 'document_review' | 'findings';

export const PaperWorkbenchModal: React.FC = () => {
  const { inspector, closeInspector } = useApp();
  const { scopedWorkpapers, scopedEngagements } = useScopedData();
  const [activeSubTab, setActiveSubTab] = useState<WorkbenchSubTab>('testing');

  const workpaperId = inspector.data?.workpaperId || inspector.data?.workpaper?.id;
  const workpaper = scopedWorkpapers.find((w) => w.id === workpaperId) || scopedWorkpapers[0];
  const engagement = workpaper ? scopedEngagements.find((e) => e.id === workpaper.engagementId) : undefined;

  if (!workpaper) {
    return (
      <div className="p-6 text-center text-secondary">
        Working paper not found or not accessible within active scope.
      </div>
    );
  }

  const lock = getWorkpaperLock(workpaper, engagement);

  const tabs: { id: WorkbenchSubTab; label: string; icon: React.FC<any> }[] = [
    { id: 'testing', label: 'Test Program', icon: ClipboardList },
    { id: 'sampling', label: 'Sample Selection', icon: Sliders },
    { id: 'evidence', label: 'Evidence Vault', icon: FileCheck },
    { id: 'analytics', label: 'Deterministic Analytics', icon: Activity },
    { id: 'document_review', label: 'Policy Review', icon: FileText },
    { id: 'findings', label: 'Exceptions & Findings', icon: AlertTriangle },
  ];

  return (
    <div className="flex flex-col h-full bg-canvas -m-6">
      <WorkbenchHeader workpaper={workpaper} engagement={engagement} />

      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-1 px-6 border-b border-hairline bg-surface overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 py-3 px-3 text-apple-12 font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-accent text-primary font-semibold'
                  : 'border-transparent text-secondary hover:text-primary'
              }`}
            >
              <Icon className="w-3.5 h-3.5 stroke-[1.3]" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-canvas">
        {activeSubTab === 'testing' && <TestingStepsTab workpaper={workpaper} lock={lock} />}
        {activeSubTab === 'sampling' && <SamplingTab workpaper={workpaper} lock={lock} />}
        {activeSubTab === 'evidence' && <EvidenceTab workpaper={workpaper} />}
        {activeSubTab === 'analytics' && <AnalyticsTab workpaper={workpaper} />}
        {activeSubTab === 'document_review' && <DocumentReviewTab workpaper={workpaper} />}
        {activeSubTab === 'findings' && <FindingsTab workpaper={workpaper} />}
      </div>
    </div>
  );
};
