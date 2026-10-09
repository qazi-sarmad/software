import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider } from './context/ThemeContext';
import { HeaderBar } from './components/common/HeaderBar';
import { NavStrip } from './components/common/NavStrip';
import { CommandPalette } from './components/common/CommandPalette';
import { InspectorPanel } from './components/common/InspectorPanel';
import { ReviewCommentsGlobalDock } from './components/reviews/ReviewCommentsGlobalDock';

// React.lazy + Suspense code-splitting of tabs per Requirement 5(b)
const ExecutiveDashboardTab = lazy(() =>
  import('./components/dashboard/ExecutiveDashboardTab').then((m) => ({
    default: m.ExecutiveDashboardTab,
  }))
);
const PendingTasksTab = lazy(() =>
  import('./components/pending/PendingTasksTab').then((m) => ({
    default: m.PendingTasksTab,
  }))
);
const SiraTab = lazy(() =>
  import('./components/sira/SiraTab').then((m) => ({
    default: m.SiraTab,
  }))
);
const AuditFileTab = lazy(() =>
  import('./components/audit/AuditFileTab').then((m) => ({
    default: m.AuditFileTab,
  }))
);
const AuditPlanTab = lazy(() =>
  import('./components/plan/AuditPlanTab').then((m) => ({
    default: m.AuditPlanTab,
  }))
);
const AuditUniverseTab = lazy(() =>
  import('./components/universe/AuditUniverseTab').then((m) => ({
    default: m.AuditUniverseTab,
  }))
);
const IssuesRegisterTab = lazy(() =>
  import('./components/issues/IssuesRegisterTab').then((m) => ({
    default: m.IssuesRegisterTab,
  }))
);
const GlassBoxPublicRoute = lazy(() =>
  import('./components/glassbox/GlassBoxPublicRoute').then((m) => ({
    default: m.GlassBoxPublicRoute,
  }))
);
const DevPalettePage = lazy(() =>
  import('./components/dev/DevPalettePage').then((m) => ({
    default: m.DevPalettePage,
  }))
);
const DevAccessPage = lazy(() =>
  import('./components/dev/DevAccessPage').then((m) => ({
    default: m.DevAccessPage,
  }))
);

// Inspector content
const ObservationDrilldown = lazy(() => import('./components/issues/ObservationDrilldown').then((m) => ({ default: m.ObservationDrilldown })));
const EntitySiraRcmModal = lazy(() => import('./components/universe/EntitySiraRcmModal').then((m) => ({ default: m.EntitySiraRcmModal })));
const PeopleAccessModal = lazy(() => import('./components/common/PeopleAccessModal').then((m) => ({ default: m.PeopleAccessModal })));
const AuditFileModal = lazy(() => import('./components/audit/AuditFileModal').then((m) => ({ default: m.AuditFileModal })));
const PaperWorkbenchModal = lazy(() => import('./components/audit/PaperWorkbenchModal').then((m) => ({ default: m.PaperWorkbenchModal })));
const RedThreadModal = lazy(() => import('./components/common/RedThreadModal').then((m) => ({ default: m.RedThreadModal })));
const GlassBoxShareModal = lazy(() => import('./components/common/GlassBoxShareModal').then((m) => ({ default: m.GlassBoxShareModal })));
const AccountSettingsModal = lazy(() => import('./components/common/AccountSettingsModal').then((m) => ({ default: m.AccountSettingsModal })));
const CommentHistoryPanel = lazy(() => import('./components/reviews/CommentHistoryPanel').then((m) => ({ default: m.CommentHistoryPanel })));
const CapInspector = lazy(() => import('./components/dashboard/CapInspector').then((m) => ({ default: m.CapInspector })));

const LoadingFallback: React.FC = () => (
  <div className="max-w-7xl mx-auto px-6 py-16 flex items-center justify-center text-secondary text-apple-13">
    <div className="flex items-center gap-2">
      <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
      <span>Loading assurance view…</span>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { activeTab, inspector, closeInspector } = useApp();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Public route /e/:token (GlassBox public upload portal)
  if (currentPath.startsWith('/e/')) {
    const token = currentPath.replace('/e/', '').split('/')[0];
    return (
      <Suspense fallback={<LoadingFallback />}>
        <GlassBoxPublicRoute tokenFromUrl={token} />
      </Suspense>
    );
  }

  // /dev/access route for RBAC testing table
  if (import.meta.env.DEV && currentPath === '/dev/access') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <DevAccessPage />
      </Suspense>
    );
  }

  // /dev/palette route: all presets side by side
  if (import.meta.env.DEV && currentPath === '/dev/palette') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <DevPalettePage />
      </Suspense>
    );
  }

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
      return 'max-w-6xl';
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
          <Suspense fallback={<LoadingFallback />}>
            {activeTab === 'executive' && <ExecutiveDashboardTab />}
            {activeTab === 'pending' && <PendingTasksTab />}
            {activeTab === 'universe' && <AuditUniverseTab />}
            {activeTab === 'plan' && <AuditPlanTab />}
            {activeTab === 'sira' && <SiraTab />}
            {activeTab === 'audit_file' && <AuditFileTab />}
            {activeTab === 'issues' && <IssuesRegisterTab />}
          </Suspense>
        </main>

        <ReviewCommentsGlobalDock />
      </motion.div>

      {/* Sliding Inspector Panel */}
      <InspectorPanel
        isOpen={isInspectorOpen}
        onClose={closeInspector}
        title={getInspectorTitle()}
        width={getInspectorWidth()}
        tall={inspector.type === 'workbench' || inspector.type === 'audit_file'}
      >
        <Suspense fallback={<div className="p-6 text-secondary text-apple-13">Loading…</div>}>{renderInspectorContent()}</Suspense>
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
