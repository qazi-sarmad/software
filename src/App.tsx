import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SignInScreen } from './components/auth/SignInScreen';
import { InlineError } from './components/common/InlineError';
import type { User } from './types';
import type { TenantSeed } from './types/seed';
import { EMPTY_SEED } from './data/emptySeed';
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
// Dev-only pages. The conditional is a build-time constant: in a production build the branch and
// the dynamic imports are removed, so these modules are not emitted into the bundle at all.
const DevPalettePage = import.meta.env.DEV
  ? lazy(() =>
      import('./components/dev/DevPalettePage').then((m) => ({
        default: m.DevPalettePage,
      }))
    )
  : null;

// Inspector content
const ObservationDrilldown = lazy(() => import('./components/issues/ObservationDrilldown').then((m) => ({ default: m.ObservationDrilldown })));
const EntitySiraRcmModal = lazy(() => import('./components/universe/EntitySiraRcmModal').then((m) => ({ default: m.EntitySiraRcmModal })));
const AuditFileModal = lazy(() => import('./components/audit/AuditFileModal').then((m) => ({ default: m.AuditFileModal })));
const PaperWorkbenchModal = lazy(() => import('./components/audit/PaperWorkbenchModal').then((m) => ({ default: m.PaperWorkbenchModal })));
const GlassBoxShareModal = lazy(() => import('./components/common/GlassBoxShareModal').then((m) => ({ default: m.GlassBoxShareModal })));
const AccountSettingsModal = lazy(() => import('./components/common/AccountSettingsModal').then((m) => ({ default: m.AccountSettingsModal })));
const CommentHistoryPanel = lazy(() => import('./components/reviews/CommentHistoryPanel').then((m) => ({ default: m.CommentHistoryPanel })));
const CapInspector = lazy(() => import('./components/dashboard/CapInspector').then((m) => ({ default: m.CapInspector })));
const PeopleAdminPanel = lazy(() => import('./components/admin/PeopleAdminPanel').then((m) => ({ default: m.PeopleAdminPanel })));

const LoadingFallback: React.FC = () => (
  <div className="max-w-7xl mx-auto px-6 py-16 flex items-center justify-center text-secondary text-apple-13">
    <div className="flex items-center gap-2">
      <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
      <span>Loading assurance view…</span>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { activeTab, inspector, closeInspector, ledgerError } = useApp();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const isInspectorOpen = Boolean(inspector.type);

  const getInspectorTitle = () => {
    switch (inspector.type) {
      case 'observation':
        return 'Audit Observation & 5C Analysis';
      case 'sira':
        return 'SIRA Risk & RCM Matrix';
      case 'audit_file':
        return 'Engagement Audit File';
      case 'workbench':
        return 'Working Paper Audit Workbench';
      case 'glassbox_share':
        return 'GlassBox — External Upload Portal';
      case 'account_settings':
        return 'Settings & Preferences';
      case 'comment_history':
        return 'Review Notes & 4-Eyes Discussion';
      case 'cap_inspector':
        return 'Corrective Action Plan (CAP) Details';
      case 'people_admin':
        return 'People & Roles';
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
      case 'audit_file':
        return <AuditFileModal />;
      case 'workbench':
        return <PaperWorkbenchModal />;
      case 'glassbox_share':
        return <GlassBoxShareModal />;
      case 'account_settings':
        return <AccountSettingsModal onClose={closeInspector} />;
      case 'comment_history':
        return <CommentHistoryPanel />;
      case 'cap_inspector':
        return <CapInspector />;
      case 'people_admin':
        return <PeopleAdminPanel />;
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

        {ledgerError && (
          <div className="max-w-7xl mx-auto w-full px-6 pt-4">
            <InlineError message={`Sealing is disabled. ${ledgerError}`} testId="ledger-error" />
          </div>
        )}

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

/**
 * The principal for the public /e/:token upload route. A token holder is not a signed-in user:
 * this principal has no scope and no capabilities, and is never used for the application shell.
 */
const EXTERNAL_TOKEN_HOLDER: User = {
  id: 'external-token-holder',
  name: 'External token holder',
  email: '',
  avatar: 'EX',
  role: 'auditee',
  universeIds: [],
  entityIds: [],
};

/** Everything behind this gate needs an authenticated session. With none, the sign-in screen shows and no data is mounted. */
// Tenant data is not part of the application bundle. The only source today is the flagged demo tenant, loaded by a
// development-only dynamic import: in a production build this is null and the module is not emitted.
const loadDemoSeed = import.meta.env.DEV ? () => import('./data/demoSeed').then((m) => m.demoSeed) : null;

const AuthGate: React.FC = () => {
  const { user } = useAuth();
  const [seed, setSeed] = useState<TenantSeed | null>(null);

  useEffect(() => {
    let live = true;
    if (user && loadDemoSeed) {
      loadDemoSeed().then((s) => {
        if (live) setSeed(s);
      });
    }
    return () => {
      live = false;
      setSeed(null);
    };
  }, [user]);

  if (!user) return <SignInScreen />;
  if (!seed) return <LoadingFallback />;
  return (
    <AppProvider key={user.id} user={user} seed={seed}>
      <AppContent />
    </AppProvider>
  );
};

const AppRoutes: React.FC = () => {
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

  // Public route /e/:token (GlassBox public upload portal). Needs no session.
  if (currentPath.startsWith('/e/')) {
    const token = currentPath.replace('/e/', '').split('/')[0];
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AppProvider user={EXTERNAL_TOKEN_HOLDER} seed={EMPTY_SEED}>
          <GlassBoxPublicRoute tokenFromUrl={token} />
        </AppProvider>
      </Suspense>
    );
  }

  // Development-only tooling routes. Absent from production builds (see src/guards/prodBundle.test.ts).
  if (import.meta.env.DEV && DevPalettePage && currentPath === '/dev/palette') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <DevPalettePage />
      </Suspense>
    );
  }

  return <AuthGate />;
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
}
