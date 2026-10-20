import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SignInScreen } from './components/auth/SignInScreen';
import { NoTenantScreen } from './components/auth/NoTenantScreen';
import { InlineError } from './components/common/InlineError';
import type { User } from './types';
import type { TenantSeed } from './types/seed';
import { EMPTY_SEED } from './data/emptySeed';
import { ThemeProvider } from './context/ThemeContext';
import { HeaderBar } from './components/common/HeaderBar';
import { NavStrip } from './components/common/NavStrip';
import { CommandPalette } from './components/common/CommandPalette';
import { FloatingWindowManager, type OpenWindow } from './components/common/FloatingWindowManager';
import { RecordContent, INSPECTOR_TITLES, RECORD_TYPE_TO_INSPECTOR } from './components/common/RecordContent';
import { ReviewCommentsGlobalDock } from './components/reviews/ReviewCommentsGlobalDock';
import { ConsultationBanner } from './components/common/ConsultationBanner';

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
const PublicVerifyRoute = lazy(() =>
  import('./components/pending/PublicVerifyRoute').then((m) => ({
    default: m.PublicVerifyRoute,
  }))
);
const ExternalAuditorPortal = lazy(() =>
  import('./components/pending/ExternalAuditorPortal').then((m) => ({
    default: m.ExternalAuditorPortal,
  }))
);
const ExternalAuditorAccept = lazy(() =>
  import('./components/pending/ExternalAuditorAccept').then((m) => ({
    default: m.ExternalAuditorAccept,
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

const LoadingFallback: React.FC = () => (
  <div className="max-w-7xl mx-auto px-6 py-16 flex items-center justify-center text-secondary text-apple-13">
    <div className="flex items-center gap-2">
      <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
      <span>Loading assurance view…</span>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { activeTab, inspector, closeInspector, ledgerError, currentUser } = useApp();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // One floating window for the current inspector record. The window id is derived from the record
  // so a re-opened record reuses the same window (and the dock restores it, not duplicates it).
  const inspectorWindow: OpenWindow | null = inspector.type
    ? {
        windowId: inspector.data?.engagement?.id
          ? `audit_file:${inspector.data.engagement.id}`
          : inspector.data?.workpaperId || inspector.data?.workpaper?.id
            ? `workbench:${inspector.data.workpaperId ?? inspector.data.workpaper.id}`
            : inspector.data?.findingId
              ? `finding:${inspector.data.findingId}`
              : `${inspector.type}`,
        recordType: inspector.type,
        recordId:
          inspector.data?.engagement?.id ??
          inspector.data?.workpaperId ??
          inspector.data?.workpaper?.id ??
          inspector.data?.findingId ??
          '',
        title: inspector.type ? INSPECTOR_TITLES[inspector.type] ?? 'Audit Inspector' : 'Audit Inspector',
        data: inspector.data,
      }
    : null;

  return (
    <div className="min-h-screen bg-canvas text-primary relative overflow-x-hidden">
      {/* The record view is non-blocking (§27.5): no scrim, no shell scaling, no modal attribute. */}
      <div className="min-h-screen flex flex-col">
        <HeaderBar onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
        <NavStrip />

        {/* GL-01 Dual Session banner (F4): a non-blocking strip, never a modal or a scrim. */}
        <ConsultationBanner orgId={currentUser.orgId} />

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
      </div>

      {/* Record view: non-blocking floating windows (§17.1, §27.5). MODE B, managed by 5C. */}
      {inspector.type && (
        <FloatingWindowManager
          windows={inspectorWindow ? [inspectorWindow] : []}
          onCloseWindow={closeInspector}
          width={inspector.type === 'workbench' || inspector.type === 'audit_file' ? 960 : 720}
        />
      )}

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

export interface ViewRecordTarget {
  recordType: string;
  recordId: string;
}

const AuthGate: React.FC<{ viewRecord?: ViewRecordTarget; externalPortal?: boolean }> = ({ viewRecord, externalPortal }) => {
  const { user, status } = useAuth();
  // In a production build there is no demo tenant to load, so the shell renders from the empty seed
  // and every screen shows its designed empty state. In development the flagged demo tenant loads.
  const [seed, setSeed] = useState<TenantSeed | null>(loadDemoSeed ? null : EMPTY_SEED);

  useEffect(() => {
    let live = true;
    if (user && loadDemoSeed) {
      loadDemoSeed().then((s) => {
        if (live) setSeed(s);
      });
    }
    return () => {
      live = false;
      setSeed(loadDemoSeed ? null : EMPTY_SEED);
    };
  }, [user]);

  // Resolve the shell from the session lifecycle, so a signed-in account with no org sees the
  // welcome screen rather than an indefinite spinner (D4).
  if (status === 'loading') return <LoadingFallback />;
  if (status === 'external_auditor') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ExternalAuditorPortal />
      </Suspense>
    );
  }
  if (status === 'no_tenant') return <NoTenantScreen />;
  if (status === 'signed_out' || status === 'platform' || !user) return <SignInScreen />;
  // The external portal is only for that principal: a signed-in tenant member who opens /external is
  // told plainly, never shown the tenant shell.
  if (externalPortal) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-6">
        <InlineError
          message="This page is for external auditors. Sign in with the account the organisation invited."
          testId="external-portal-wrong-principal"
        />
      </div>
    );
  }
  if (!seed) return <LoadingFallback />;
  return (
    <AppProvider key={user.id} user={user} seed={seed}>
      {viewRecord ? <RecordPage target={viewRecord} /> : <AppContent />}
    </AppProvider>
  );
};

/**
 * Full-page record view (MODE A). A breadcrumb returns to the application; there is no overlay.
 * The record is opened in the shared content renderer, so both modes show the same component.
 */
const RecordPage: React.FC<{ target: ViewRecordTarget }> = ({ target }) => {
  const { openInspector, closeInspector } = useApp();
  const type = RECORD_TYPE_TO_INSPECTOR[target.recordType];

  useEffect(() => {
    if (!type) return;
    const data =
      target.recordType === 'engagement'
        ? { engagement: { id: target.recordId } }
        : target.recordType === 'finding'
        ? { findingId: target.recordId }
        : { id: target.recordId };
    openInspector(type, data);
    return () => closeInspector();
  }, [type, target.recordId]);

  return (
    <div className="min-h-screen bg-canvas text-primary">
      <HeaderBar onOpenCommandPalette={() => {}} />
      <div className="max-w-6xl mx-auto px-6 py-6">
        <nav aria-label="Breadcrumb" className="mb-4 text-apple-12 text-secondary flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="hover:text-primary transition-colors"
          >
            Dashboard
          </button>
          <span aria-hidden>/</span>
          <span className="text-primary">{INSPECTOR_TITLES[type] ?? 'Record'}</span>
        </nav>
        {type ? (
          <div className="rounded-2xl border border-hairline bg-surface p-6" data-testid="record-page">
            <RecordContent
              type={type}
              data={
                target.recordType === 'engagement'
                  ? { engagement: { id: target.recordId } }
                  : target.recordType === 'finding'
                  ? { findingId: target.recordId }
                  : { id: target.recordId }
              }
              onClose={() => {}}
            />
          </div>
        ) : (
          <InlineError message="That record type is not available." testId="record-page-unknown" />
        )}
      </div>
    </div>
  );
};

const SuperAdminPortal = lazy(() =>
  import('./components/superadmin/SuperAdminPortal').then((m) => ({ default: m.SuperAdminPortal }))
);

/** Shows the sign-in screen for an unauthenticated visitor, else the portal (which re-checks the role). */
const PlatformGate: React.FC = () => {
  const { user, isPlatform } = useAuth();
  // An org member (user) is signed in but not platform staff: render the portal, which denies it in
  // the database. Platform staff have no org identity, so `user` is null and `isPlatform` is true.
  if (!user && !isPlatform) return <SignInScreen />;
  return <SuperAdminPortal />;
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

  // Public route /verify/:id (certificate) and /pack/:id (Board Pack). The ONLY anonymous surface
  // (F11). Needs no session and touches no tenant table as anon.
  if (currentPath.startsWith('/verify/') || currentPath.startsWith('/pack/')) {
    const kind = currentPath.startsWith('/verify/') ? 'verify' : 'pack';
    const id = currentPath.replace(kind === 'verify' ? '/verify/' : '/pack/', '').split('/')[0];
    return (
      <Suspense fallback={<LoadingFallback />}>
        <AppProvider user={EXTERNAL_TOKEN_HOLDER} seed={EMPTY_SEED}>
          <PublicVerifyRoute kind={kind} idFromUrl={id} />
        </AppProvider>
      </Suspense>
    );
  }

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

  // External auditor invitation acceptance (/external/accept?token=...). The visitor must be signed
  // in; the token is presented to the invite-user Edge Function, which binds the account. Kept
  // outside the tenant shell, like the portal itself.
  if (currentPath.startsWith('/external/accept')) {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ExternalAuditorAccept tokenFromUrl={token} />
      </Suspense>
    );
  }

  // External auditor portal (/external). A separate read-only principal (F13): it needs a session,
  // so it renders behind the auth gate, but never inside the tenant application shell.
  if (currentPath.startsWith('/external')) {
    return <AuthGate externalPortal />;
  }

  // Development-only tooling routes. Absent from production builds (see src/guards/prodBundle.test.ts).
  if (import.meta.env.DEV && DevPalettePage && currentPath === '/dev/palette') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <DevPalettePage />
      </Suspense>
    );
  }

  // Super Admin portal (/superadmin, spec §24). A separate console for QSCorp platform staff. It
  // renders the portal for an authenticated session and the sign-in screen otherwise; the portal
  // itself re-checks the platform role in the database and shows a denial screen without it.
  if (currentPath === '/superadmin') {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <PlatformGate />
      </Suspense>
    );
  }

  // Full-page record view (/view/:recordType/:id), used by MODE A of the record view and by the
  // pop-out window (§17.1, §27.5). It needs a session, so it renders behind the auth gate.
  if (currentPath.startsWith('/view/')) {
    const [, , recordType, recordId] = currentPath.split('/');
    return <AuthGate viewRecord={{ recordType, recordId }} />;
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
