import React, { useState, useEffect, Suspense, lazy } from 'react';
import { motion } from 'motion/react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SignInScreen } from './components/auth/SignInScreen';
import { MfaChallenge } from './components/auth/MfaChallenge';
import { isPlatformAdminPath } from './lib/platformPath';
import { NoTenantScreen } from './components/auth/NoTenantScreen';
import { WithheldScreen } from './components/auth/WithheldScreen';
import { InlineError } from './components/common/InlineError';
import { LiveAnnouncerProvider } from './components/common/LiveAnnouncer';
import type { User } from './types';
import type { TenantSeed } from './types/seed';
import { EMPTY_SEED } from './data/emptySeed';
import { hasSupabaseConfig } from './data/client';
import { loadTenantSnapshot, snapshotToSeed } from './data/tenant';
import { ThemeProvider } from './context/ThemeContext';
import { HeaderBar } from './components/common/HeaderBar';
import { NavStrip } from './components/common/NavStrip';
import { CommandPalette } from './components/common/CommandPalette';
import { ShortcutSheet } from './components/common/ShortcutSheet';
import { matchShortcut, matchSequence, isMacPlatform, type Shortcut } from './lib/keyboardShortcuts';
import { FloatingWindowManager, type OpenWindow } from './components/common/FloatingWindowManager';
import { RecordContent, INSPECTOR_TITLES, RECORD_TYPE_TO_INSPECTOR } from './components/common/RecordContent';
import { ReviewCommentsGlobalDock } from './components/reviews/ReviewCommentsGlobalDock';
import { ConsultationBanner } from './components/common/ConsultationBanner';
import { useRecordRevisionSync } from './hooks/useRecordRevisionSync';

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
// C2.4: the member invitation acceptance route (/invite/accept?token=…). It is outside the tenant
// shell because the invitee has no account yet; the screen creates the account and applies the
// invitation, exactly as the external auditor acceptance does.
const MemberAccept = lazy(() =>
  import('./components/pending/MemberAccept').then((m) => ({
    default: m.MemberAccept,
  }))
);
// C1.1: the Microsoft Graph sign-in callback (OA-11 / SA-04). Kept outside the tenant shell so the
// platform-level flow also lands here.
const GraphOauthCallback = lazy(() =>
  import('./components/auth/GraphOauthCallback').then((m) => ({
    default: m.GraphOauthCallback,
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
  const { activeTab, setActiveTab, inspector, closeInspector, ledgerError, currentUser, openInspector } = useApp();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutSheetOpen, setIsShortcutSheetOpen] = useState(false);

  // The global keyboard layer (U8). `Cmd/Ctrl-K` opens the palette from anywhere; `?` opens the
  // shortcut sheet; a `g`-prefixed sequence navigates without the mouse. The decisions (which
  // shortcut a keydown is, and whether a bare letter must be suppressed inside a text field) live
  // in the pure `src/lib/keyboardShortcuts.ts`; this effect only performs the resulting action.
  useEffect(() => {
    let pendingLeader: Shortcut | null = null;
    let leaderTimer: number | undefined;
    const clearLeader = () => {
      pendingLeader = null;
      if (leaderTimer) window.clearTimeout(leaderTimer);
      leaderTimer = undefined;
    };
    const target = (e: KeyboardEvent) => e.target as HTMLElement | null;
    const inEditable = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const editable = inEditable(target(e));
      if (pendingLeader) {
        const resolved = matchSequence(pendingLeader, e.key);
        clearLeader();
        if (resolved?.target.tab) {
          e.preventDefault();
          setActiveTab(resolved.target.tab);
        }
        return;
      }
      const hit = matchShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, inEditable: editable }, isMacPlatform());
      if (!hit) return;
      if (hit.sequenceKey) {
        e.preventDefault();
        pendingLeader = hit;
        leaderTimer = window.setTimeout(clearLeader, 1200);
        return;
      }
      if (hit.target.commandPalette) {
        e.preventDefault();
        setIsCommandPaletteOpen((open) => !open);
      } else if (hit.target.shortcutSheet) {
        e.preventDefault();
        setIsShortcutSheetOpen((open) => !open);
      } else if (hit.target.inspector) {
        e.preventDefault();
        openInspector(hit.target.inspector as Parameters<typeof openInspector>[0]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setActiveTab, openInspector]);

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
            {/* The tab root carries its own `data-testid` (`tab-<id>`) from ONE place, so every tab
                screen is addressable without each component repeating the wrapper. */}
            <div data-testid={`tab-${activeTab}`}>
              {activeTab === 'executive' && <ExecutiveDashboardTab />}
              {activeTab === 'pending' && <PendingTasksTab />}
              {activeTab === 'universe' && <AuditUniverseTab />}
              {activeTab === 'plan' && <AuditPlanTab />}
              {activeTab === 'sira' && <SiraTab />}
              {activeTab === 'audit_file' && <AuditFileTab />}
              {activeTab === 'issues' && <IssuesRegisterTab />}
            </div>
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

      {/* Keyboard shortcut sheet (U8). `?` opens it anywhere; non-blocking, never a modal. */}
      <ShortcutSheet
        isOpen={isShortcutSheetOpen}
        onClose={() => setIsShortcutSheetOpen(false)}
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
// Tenant data is not part of the application bundle. There are two sources:
//   - a configured Supabase project: the shell hydrates from the database (src/data/tenant.ts), which
//     is the production path. The row-level security policies decide what the session may read.
//   - no Supabase project at all (a bare dev checkout): the flagged demo tenant, loaded by a
//     development-only dynamic import. In a production build this is null and the module is not emitted.
const loadDemoSeed = !hasSupabaseConfig() && import.meta.env.DEV
  ? () => import('./data/demoSeed').then((m) => m.demoSeed)
  : null;
const useDatabase = hasSupabaseConfig();

export interface ViewRecordTarget {
  recordType: string;
  recordId: string;
}

const AuthGate: React.FC<{ viewRecord?: ViewRecordTarget; externalPortal?: boolean }> = ({ viewRecord, externalPortal }) => {
  const { user, status } = useAuth();
  // With a configured project the seed starts empty and is filled by the database loader below; with
  // no project the demo tenant (development) or the empty seed (production) is used.
  const [seed, setSeed] = useState<TenantSeed | null>(loadDemoSeed ? null : EMPTY_SEED);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    if (!user) {
      setSeed(loadDemoSeed ? null : EMPTY_SEED);
      return () => { live = false; };
    }
    if (useDatabase) {
      // The database is the source of truth: hydrate the shell from RLS-scoped reads. A failed read is
      // reported and the shell falls back to the empty seed rather than hanging on a spinner.
      setSeed(null);
      loadTenantSnapshot()
        .then((snapshot) => {
          if (live) setSeed(snapshotToSeed(snapshot, user));
        })
        .catch((err) => {
          if (!live) return;
          setLoadError(err instanceof Error ? err.message : 'Tenant data could not be loaded.');
          setSeed(EMPTY_SEED);
        });
      return () => { live = false; };
    }
    if (loadDemoSeed) {
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
  // The organisation's security policy withheld the tenant claims (0204 SSO, 0207 second factor).
  // RLS already shows this member nothing; the screen offers the challenge or the SSO guidance.
  if (status === 'withheld') return <WithheldScreen />;
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
      {loadError && (
        <div className="max-w-7xl mx-auto w-full px-6 pt-4">
          <InlineError
            message={`Some tenant data could not be loaded from the database. ${loadError}`}
            testId="tenant-load-error"
          />
        </div>
      )}
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
  // §17.1 pop-out live sync: this page and the window that opened it share localStorage; a write in
  // either window re-reads the record here. The revision is shown so the sync is observable.
  const { revision, bump } = useRecordRevisionSync(target.recordType, target.recordId);

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
  }, [type, target.recordId, revision]);

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
          <span className="flex-1" />
          <span className="text-apple-11 text-tertiary tabular-nums" data-testid="record-page-revision">
            Revision {revision}
          </span>
          <button
            type="button"
            onClick={bump}
            data-testid="record-page-refresh"
            className="px-2 py-0.5 rounded-lg text-apple-12 text-accent border border-hairline hover:bg-surface"
          >
            Refresh
          </button>
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
  const { user, isPlatform, platformNeedsMfa, refreshPlatformMfa, withheld } = useAuth();
  // An org member (user) is signed in but not platform staff: render the portal, which denies it in
  // the database. Platform staff have no org identity, so `user` is null and `isPlatform` is true.
  if (withheld) return <WithheldScreen />;
  if (!user && !isPlatform) return <SignInScreen />;
  // WP9: when the platform requires a second factor and the session has not completed one, show the
  // MFA challenge instead of the portal. The database refuses every platform RPC until AAL2, so this
  // is the honest UI for a state the database already enforces.
  if (platformNeedsMfa) return <MfaChallenge onSatisfied={() => void refreshPlatformMfa()} />;
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

  // Public route /verify/:id (certificate), /pack/:id (Board Pack) and /root/:hash (report graph
  // root, W10.3). The ONLY anonymous surface (F11). Needs no session and touches no tenant table as
  // anon.
  if (currentPath.startsWith('/verify/') || currentPath.startsWith('/pack/') || currentPath.startsWith('/root/')) {
    const kind = currentPath.startsWith('/verify/') ? 'verify'
      : currentPath.startsWith('/pack/') ? 'pack' : 'root';
    const prefix = kind === 'verify' ? '/verify/' : kind === 'pack' ? '/pack/' : '/root/';
    const id = currentPath.replace(prefix, '').split('/')[0];
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

  // Member invitation acceptance (/invite/accept?token=…, C2.4). Outside the tenant shell and
  // outside the auth gate: the invitee has no account yet, so the screen creates it and applies the
  // invitation. It renders no tenant data, so it needs no session.
  if (currentPath.startsWith('/invite/accept')) {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MemberAccept tokenFromUrl={token} />
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

  // Microsoft Graph sign-in callback (/oauth/graph, C1.1). Like /external/accept it sits outside the
  // tenant shell, so the platform-level flow also lands here; the Edge Function verifies the session
  // from the bearer token before it does anything, so an anonymous visit stores nothing.
  if (currentPath.startsWith('/oauth/graph')) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <GraphOauthCallback screenId="oa-11" />
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

  // Super Admin portal (spec §24). A separate console for QSCorp platform staff, reached only on the
  // unlisted path in VITE_PLATFORM_ADMIN_PATH (WP9; default /superadmin). It renders the portal for
  // an authenticated session and the sign-in screen otherwise; the portal itself re-checks the
  // platform role in the database and shows a denial screen without it. No navigation link points
  // here, and the path is not a constant in the bundle, so an attacker must know it already.
  if (isPlatformAdminPath(currentPath)) {
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
      <LiveAnnouncerProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </LiveAnnouncerProvider>
    </ThemeProvider>
  );
}
