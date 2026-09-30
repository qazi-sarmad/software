import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { HeaderBar } from './components/common/HeaderBar';
import { NavStrip } from './components/common/NavStrip';
import { CommandPalette } from './components/common/CommandPalette';
import { InspectorPanel } from './components/common/InspectorPanel';
import { ReviewCommentsGlobalDock } from './components/reviews/ReviewCommentsGlobalDock';

// Tabs
import { ExecutiveDashboardTab } from './components/dashboard/ExecutiveDashboardTab';
import { AuditCalendarTab } from './components/calendar/AuditCalendarTab';
import { AuditPlanTab } from './components/plan/AuditPlanTab';
import { AuditUniverseTab } from './components/universe/AuditUniverseTab';
import { IssuesRegisterTab } from './components/issues/IssuesRegisterTab';
import { ReportsTab } from './components/reports/ReportsTab';

// Inspector content
import { ObservationDrilldown } from './components/issues/ObservationDrilldown';
import { EntitySiraRcmModal } from './components/universe/EntitySiraRcmModal';
import { PeopleAccessModal } from './components/common/PeopleAccessModal';
import { AuditFileModal } from './components/audit/AuditFileModal';
import { PaperWorkbenchModal } from './components/audit/PaperWorkbenchModal';
import { RedThreadModal } from './components/common/RedThreadModal';
import { GlassBoxShareModal } from './components/common/GlassBoxShareModal';
import { AccountSettingsModal } from './components/common/AccountSettingsModal';
import { CommentHistoryPanel } from './components/reviews/CommentHistoryPanel';
import { CapInspector } from './components/dashboard/CapInspector';

const AppContent: React.FC = () => {
  const { activeTab, inspector, closeInspector } = useApp();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const isInspectorOpen = Boolean(inspector.type);

  const getInspectorTitle = () => {
    switch (inspector.type) {
      case 'observation':
        return 'Audit Observation & 5C Analysis';
      case 'sira':
        return 'SIRA Risk & RCM Matrix';
      case 'people':
        return 'Personnel Directory & Scoped Access';
      case 'audit_file':
        return 'Engagement Audit File';
      case 'workbench':
        return 'Working Paper Audit Workbench';
      case 'red_thread':
        return 'Red Thread — Lineage Trace';
      case 'glassbox_share':
        return 'GlassBox — External Upload Portal';
      case 'account_settings':
        return 'Settings & Preferences';
      case 'comment_history':
        return 'Review Notes & 4-Eyes Discussion';
      case 'cap_inspector':
        return 'Corrective Action Plan (CAP) Details';
      default:
        return 'Audit Inspector';
    }
  };

  const renderInspectorContent = () => {
    switch (inspector.type) {
      case 'observation':
        return <ObservationDrilldown data={inspector.data} />;
      case 'sira':
        return <EntitySiraRcmModal entity={inspector.data?.entity} onClose={closeInspector} />;
      case 'people':
        return <PeopleAccessModal />;
      case 'audit_file':
        return <AuditFileModal />;
      case 'workbench':
        return <PaperWorkbenchModal />;
      case 'red_thread':
        return <RedThreadModal />;
      case 'glassbox_share':
        return <GlassBoxShareModal />;
      case 'account_settings':
        return <AccountSettingsModal onClose={closeInspector} />;
      case 'comment_history':
        return <CommentHistoryPanel />;
      case 'cap_inspector':
        return <CapInspector />;
      default:
        return null;
    }
  };

  const getInspectorWidth = () => {
    if (inspector.type === 'workbench' || inspector.type === 'audit_file') {
      return 'max-w-5xl';
    }
    return 'max-w-2xl';
  };

  return (
    <div className="min-h-screen bg-canvas text-primary relative overflow-x-hidden">
      {/* Shell scales to 0.98 when sliding inspector is open (⚖ Spec: NO BLOCKING MODALS) */}
      <motion.div
        animate={{
          scale: isInspectorOpen ? 0.98 : 1,
          opacity: isInspectorOpen ? 0.92 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 30,
        }}
        className="min-h-screen flex flex-col origin-center"
      >
        <HeaderBar onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
        <NavStrip />

        <main className="flex-1 pb-16">
          {activeTab === 'dashboard' && <ExecutiveDashboardTab />}
          {activeTab === 'calendar' && <AuditCalendarTab />}
          {activeTab === 'plan' && <AuditPlanTab />}
          {activeTab === 'universe' && <AuditUniverseTab />}
          {activeTab === 'issues' && <IssuesRegisterTab />}
          {activeTab === 'reports' && <ReportsTab />}
        </main>

        <ReviewCommentsGlobalDock />
      </motion.div>

      {/* Sliding Inspector Panel */}
      <InspectorPanel
        isOpen={isInspectorOpen}
        onClose={closeInspector}
        title={getInspectorTitle()}
        width={getInspectorWidth()}
      >
        {renderInspectorContent()}
      </InspectorPanel>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeProvider>
  );
}
