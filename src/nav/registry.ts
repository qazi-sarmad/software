/**
 * Screen registry — the mount point that lets several build streams add screens without any of them
 * editing `App.tsx`, `AppContext.tsx` or this file (docs/build/OWNERSHIP.md §4.1).
 *
 * A slot is keyed by `screenId` and points at a component **path**. It holds no component value and
 * imports nothing from React or the database: it is a pure data module (rule M8; no clock).
 *
 * The registry already lists every planned screen, pointing at its slot's eventual component path.
 * A stream fills its slot by creating its **own** component file at that path; it does NOT edit this
 * file. The integrator flips a slot's `status` from `planned` to `mounted` and wires the render at
 * merge time (OWNERSHIP.md §7.3).
 *
 * The screen ids that cover Appendix A and Appendix B of `docs/ACP-UI-CONTRACT.md` are the authored
 * interface; this registry names the slots the concurrent streams will fill into it.
 */

/** The concurrent-build streams (docs/build/OWNERSHIP.md §1), plus the trunk/integrator. */
export type StreamId =
  | 'trunk'
  | 'design'
  | 's1'
  | 's2'
  | 's3'
  | 's4'
  | 's5'
  | 's6'
  | 's7';

export type ScreenStatus = 'mounted' | 'planned';

export interface ScreenMount {
  /** The stable screen id (the contract's section id, e.g. `AF-16`, or a reserved planned id). */
  screenId: string;
  /** A short human title for the slot. */
  title: string;
  /** The stream that owns the component behind this slot (OWNERSHIP.md §1). */
  owner: StreamId;
  /** The component module path, relative to the repository root. */
  path: string;
  /** `mounted` when the component exists and is rendered; `planned` while the owner stream is yet to fill it. */
  status: ScreenStatus;
}

/**
 * The existing top-level screens the trunk owns (mounted). These are the routes and chrome that
 * already exist; they are listed so the registry is the one place that names a screen and its file.
 */
export const MOUNTED_SCREENS: ScreenMount[] = [
  { screenId: 'DB-01', title: 'Executive Dashboard', owner: 'trunk', path: 'src/components/dashboard/ExecutiveDashboardTab.tsx', status: 'mounted' },
  { screenId: 'DB-02', title: 'Deterministic capability library', owner: 'trunk', path: 'src/components/dashboard/CapabilityLibraryPanel.tsx', status: 'mounted' },
  { screenId: 'WQ-01', title: 'Work Queue', owner: 'trunk', path: 'src/components/pending/PendingTasksTab.tsx', status: 'mounted' },
  { screenId: 'AU-01', title: 'Audit Universe', owner: 's3', path: 'src/components/universe/AuditUniverseTab.tsx', status: 'mounted' },
  { screenId: 'AP-01', title: 'Audit Plan', owner: 'trunk', path: 'src/components/plan/AuditPlanTab.tsx', status: 'mounted' },
  { screenId: 'SR-01', title: 'SIRA', owner: 's3', path: 'src/components/sira/SiraTab.tsx', status: 'mounted' },
  { screenId: 'AF-01', title: 'Audit File', owner: 'trunk', path: 'src/components/audit/AuditFileTab.tsx', status: 'mounted' },
  { screenId: 'AF-16', title: 'Rule run', owner: 's1', path: 'src/components/audit/RuleRunTab.tsx', status: 'mounted' },
  { screenId: 'OA-33', title: 'Rule packs', owner: 's1', path: 'src/components/admin/RulePackPanel.tsx', status: 'mounted' },
  { screenId: 'IR-01', title: 'Issues & CAP Register', owner: 'trunk', path: 'src/components/issues/IssuesRegisterTab.tsx', status: 'mounted' },
  { screenId: 'SA-17', title: 'Super Admin portal', owner: 's4', path: 'src/components/superadmin/SuperAdminPortal.tsx', status: 'mounted' },
  { screenId: 'SA-02', title: 'Platform health and support grants', owner: 's4', path: 'src/components/superadmin/SuperAdminSupport.tsx', status: 'mounted' },
  { screenId: 'AX-01', title: 'Sign-in', owner: 'trunk', path: 'src/components/auth/SignInScreen.tsx', status: 'mounted' },
  { screenId: 'AX-02', title: 'No-tenant', owner: 'trunk', path: 'src/components/auth/NoTenantScreen.tsx', status: 'mounted' },
  { screenId: 'CH-01', title: 'Navigation strip', owner: 'trunk', path: 'src/components/common/NavStrip.tsx', status: 'mounted' },
  { screenId: 'CH-02', title: 'Header bar', owner: 'trunk', path: 'src/components/common/HeaderBar.tsx', status: 'mounted' },
  { screenId: 'CH-03', title: 'Command palette', owner: 'trunk', path: 'src/components/common/CommandPalette.tsx', status: 'mounted' },
  { screenId: 'CH-04', title: 'Floating windows and dock', owner: 'trunk', path: 'src/components/common/FloatingWindowManager.tsx', status: 'mounted' },
  { screenId: 'WK-06', title: 'Public verification', owner: 'trunk', path: 'src/components/pending/PublicVerifyRoute.tsx', status: 'mounted' },
  { screenId: 'OA-11', title: 'Graph sign-in callback', owner: 'trunk', path: 'src/components/auth/GraphOauthCallback.tsx', status: 'mounted' },
  { screenId: 'OA-23', title: 'Connectors and continuous monitoring', owner: 's5', path: 'src/components/writing/ConnectorMonitorPanel.tsx', status: 'mounted' },
  { screenId: 'OA-29', title: 'Integrity alarm', owner: 'trunk', path: 'src/components/admin/IntegrityAlarmPanel.tsx', status: 'mounted' },
  { screenId: 'OA-30', title: 'Attestation', owner: 'trunk', path: 'src/components/admin/AttestationPanel.tsx', status: 'mounted' },
  { screenId: 'OA-39', title: 'Global document search', owner: 's7', path: 'src/components/documents/GlobalSearchPanel.tsx', status: 'mounted' },
  { screenId: 'OA-36', title: 'Documents, minutes and policy review', owner: 's7', path: 'src/components/documents/DocumentReviewPanel.tsx', status: 'mounted' },
  { screenId: 'OA-38', title: 'Ad-hoc review builder', owner: 's7', path: 'src/components/documents/AdhocReviewPanel.tsx', status: 'mounted' },
  { screenId: 'OA-34', title: 'Assurance capabilities (D5/D7/D8/D9)', owner: 's2', path: 'src/components/assurance/AssuranceCapabilitiesPanel.tsx', status: 'mounted' },
  { screenId: 'OA-37', title: 'Client classification (D10)', owner: 's3', path: 'src/components/universe/ClientClassificationPanel.tsx', status: 'mounted' },
  { screenId: 'SR-04', title: 'Risk library and dynamic risk assessment (D14/D15)', owner: 's3', path: 'src/components/sira/RiskLibraryPanel.tsx', status: 'mounted' },
  { screenId: 'OA-41', title: 'Archived-file custodian role', owner: 'trunk', path: 'src/components/admin/ArchivedFileRolePanel.tsx', status: 'mounted' },
  { screenId: 'SA-19', title: 'Audit domains and rule packs (D11)', owner: 's4', path: 'src/components/superadmin/SuperAdminDomains.tsx', status: 'mounted' },
  { screenId: 'SA-21', title: 'Standards distribution (D16)', owner: 's4', path: 'src/components/superadmin/SuperAdminStandards.tsx', status: 'mounted' },
];

/**
 * The slots the concurrent build streams will fill. Each is a NEW surface its stream's scope
 * describes; the stream adds the matching contract section in `docs/ACP-UI-CONTRACT.md` and creates
 * its component file at `path`. None of these exists yet, so every status is `planned`.
 */
export const PLANNED_SCREENS: ScreenMount[] = [
  // S2 — assurance capabilities D5/D7/D8/D9.
  // OA-34 (assurance capabilities) is now mounted; its slot lives in MOUNTED_SCREENS.
  // S3 — client classification D10; risk library and dynamic assessment D14/D15.
  // S4 — audit domains D11; readiness/complaints/diagnostics D12/D13; standards distribution D16.
  // SA-19 (audit domains) and SA-21 (standards distribution) are now mounted; their slots live in
  // MOUNTED_SCREENS.
  { screenId: 'SA-20', title: 'Readiness signals, complaints and self-diagnostic (D12/D13)', owner: 's4', path: 'src/components/superadmin/SuperAdminReadiness.tsx', status: 'planned' },
  // S7 — document, minutes and policy rule surfaces (S7/S8/S9/S14/S15).
  // OA-36 (document review) is now mounted; its slot lives in MOUNTED_SCREENS.
];

/** Every slot, mounted and planned, in a stable order. */
export const SCREEN_MOUNTS: ScreenMount[] = [...MOUNTED_SCREENS, ...PLANNED_SCREENS];

/** The slot for a screen id, or undefined when the registry does not know the id. */
export function screenMount(screenId: string): ScreenMount | undefined {
  return SCREEN_MOUNTS.find((m) => m.screenId === screenId);
}

/** Every slot owned by a stream. */
export function mountsForStream(owner: StreamId): ScreenMount[] {
  return SCREEN_MOUNTS.filter((m) => m.owner === owner);
}

/** The slots still waiting for their owner stream to land the component. */
export function plannedScreens(): ScreenMount[] {
  return PLANNED_SCREENS;
}

/** True when the component behind a slot is mounted (exists and is rendered). */
export function isMounted(screenId: string): boolean {
  return screenMount(screenId)?.status === 'mounted';
}
