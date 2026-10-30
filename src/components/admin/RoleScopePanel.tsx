import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight, RIGHTS, type Right } from '../../lib/rights';
import {
  applicableDefaults,
  explainAccess,
  resolveAccess,
  SCOPE_KINDS,
  SCOPE_LABELS,
  type RightsByRole,
  type ScopeKind,
} from '../../lib/roleAccess';
import {
  assignRole,
  clearScopeDefault,
  effectiveAccess,
  listRoleAssignments,
  listScopeDefaults,
  setScopeDefault,
  unassignRole,
  type RoleAssignmentView,
  type ScopeDefaultView,
} from '../../data/roleScope';
import { listMembers, listRoles, type AdminResult, type MemberRow, type RoleRow } from '../../data/admin';
import { listScopeTargets } from '../../data/roleScope';
import { Select } from '../common/Select';
import { Check, Plus, Shield, X, XCircle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const RIGHT_LABELS: Record<Right, string> = {
  manage_users: 'Manage users',
  manage_roles: 'Manage roles',
  edit_config: 'Edit configuration',
  manage_engagements: 'Manage engagements',
  approve_plan: 'Approve plan',
  review_and_approve: 'Review and approve',
  perform_work: 'Perform work',
  can_reopen: 'Reopen engagements',
  view_all_scopes: 'View all scopes',
  read_only: 'Read only',
  manage_team: 'Manage team',
  view_board_pack: 'View Board Pack',
  generate_board_pack: 'Generate Board Pack',
  view_insights: 'View insights',
};

function Banner({ result, onDismiss }: { result: AdminResult | null; onDismiss: () => void }) {
  if (!result || result.ok) return null;
  return (
    <div
      role="alert"
      data-testid="rolescope-error"
      className="flex items-start gap-2 rounded-xl border border-cinnabar bg-cinnabar-subtle px-3 py-2 text-apple-12 text-primary"
    >
      <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5] mt-0.5 shrink-0" />
      <span className="flex-1">{result.reason}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-secondary hover:text-primary">×</button>
    </div>
  );
}

/**
 * Scoped roles and access (owner instruction 2026-10-30: every role configurable per org, per
 * universe and per engagement; complete customization in roles and access).
 *
 * Two things the flat membership role cannot express, made visual here:
 *   1. the DEFAULTS an organisation applies at each scope — "for a new engagement in this universe,
 *      start the team with these roles";
 *   2. the ASSIGNMENTS a person holds at a scope — the same person is a Reviewer here and the
 *      Preparer there.
 *
 * Every control is gated by a right (hasRight), never a role name. The resolution the screen shows is
 * the pure model's, and the database re-derives it; both are proved to agree by test 143 and
 * src/lib/roleAccess.test.ts.
 */
export const RoleScopePanel: React.FC = () => {
  const { currentUser } = useApp();
  const canManageRoles = hasRight(currentUser, 'manage_roles');
  const canManageUsers = hasRight(currentUser, 'manage_users');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [defaults, setDefaults] = useState<ScopeDefaultView[]>([]);
  const [assignments, setAssignments] = useState<RoleAssignmentView[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [universes, setUniverses] = useState<{ id: string; name: string }[]>([]);
  const [engagements, setEngagements] = useState<{ id: string; title: string; universeId: string }[]>([]);
  const [result, setResult] = useState<AdminResult | null>(null);

  // The default-configuration form.
  const [dScope, setDScope] = useState<ScopeKind>('org');
  const [dUniverse, setDUniverse] = useState('');
  const [dEngagement, setDEngagement] = useState('');
  const [dRole, setDRole] = useState('');
  const [dReason, setDReason] = useState('');

  // The assignment form.
  const [aUser, setAUser] = useState('');
  const [aScope, setAScope] = useState<ScopeKind>('org');
  const [aUniverse, setAUniverse] = useState('');
  const [aEngagement, setAEngagement] = useState('');
  const [aRole, setARole] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [d, a, r, m, targets] = await Promise.all([
        listScopeDefaults(),
        listRoleAssignments(),
        listRoles(),
        canManageUsers ? listMembers() : Promise.resolve([] as MemberRow[]),
        listScopeTargets(),
      ]);
      setDefaults(d);
      setAssignments(a);
      setRoles(r);
      setMembers(m);
      setUniverses(targets.universes);
      setEngagements(targets.engagements);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'The scoped roles could not be loaded.');
      setState('error');
    }
  }, [canManageUsers]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<AdminResult>) => {
    const r = await action();
    setResult(r);
    if (r.ok) await load();
    return r;
  };

  const rightsByRole: RightsByRole = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.slug, r.rights])),
    [roles],
  );
  const labelFor = useCallback(
    (slug: string) => roles.find((r) => r.slug === slug)?.name ?? slug,
    [roles],
  );

  const engagementUniverse = useCallback(
    (engagementId: string) => engagements.find((e) => e.id === engagementId)?.universeId ?? null,
    [engagements],
  );

  // What the assignment form would inherit at the chosen scope, and the rights it would confer.
  const previewRoles = useMemo(() => {
    if (aRole) return [aRole];
    const inherited = applicableDefaults(defaults, aScope === 'universe' ? aUniverse : engagementUniverse(aEngagement),
      aScope === 'engagement' ? aEngagement : null);
    return inherited?.roleSlugs ?? [];
  }, [aRole, defaults, aScope, aUniverse, aEngagement, engagementUniverse]);

  const previewRights = useMemo(() => {
    const access = resolveAccess(
      previewRoles.map((slug, i) => ({
        id: `preview-${i}`, userId: 'preview', scopeKind: aScope,
        universeId: aScope === 'universe' ? aUniverse : null,
        engagementId: aScope === 'engagement' ? aEngagement : null,
        roleSlug: slug, isDefault: !aRole,
      })),
      null, rightsByRole, 'preview',
      aScope === 'universe' ? aUniverse : engagementUniverse(aEngagement),
      aScope === 'engagement' ? aEngagement : null,
    );
    return RIGHTS.filter((r) => access.rights[r] === true);
  }, [previewRoles, aScope, aUniverse, aEngagement, engagementUniverse, rightsByRole, aRole]);

  const scopeLabel = (d: { scopeKind: ScopeKind; universeName: string | null; engagementTitle: string | null }) => {
    if (d.scopeKind === 'universe') return d.universeName ?? 'Universe';
    if (d.scopeKind === 'engagement') return d.engagementTitle ?? 'Engagement';
    return 'Whole organisation';
  };

  if (state === 'loading') {
    return <div data-testid="rolescope-loading" className="py-8 text-center text-secondary text-apple-13">Loading roles and access…</div>;
  }
  if (state === 'error') {
    return <div data-testid="rolescope-load-error" className="py-8 text-center text-cinnabar text-apple-13">{loadError}</div>;
  }

  return (
    <div data-testid="rolescope-panel" className="space-y-6">
      <Banner result={result} onDismiss={() => setResult(null)} />

      {!canManageRoles && !canManageUsers && (
        <p data-testid="rolescope-readonly" className="text-apple-12 text-secondary">
          You can view the scoped roles and access, but changing them needs <em>Manage roles</em> or <em>Manage users</em>.
        </p>
      )}

      {/* ------------------------------------------------------------------ defaults */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <header className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-secondary stroke-[1.5]" />
          <h3 className="text-apple-14 font-semibold text-primary">Default roles by scope</h3>
        </header>
        <p className="text-apple-12 text-secondary">
          Choose the roles a new team inherits. The nearest scope that has a default wins: an
          engagement default beats the universe's, which beats the organisation's.
        </p>

        <div data-testid="rolescope-defaults" className="divide-y divide-hairline rounded-xl border border-hairline">
          {defaults.length === 0 ? (
            <p data-testid="rolescope-defaults-empty" className="px-3 py-3 text-apple-12 text-secondary">
              No defaults configured. An organisation that configures nothing keeps its membership role.
            </p>
          ) : (
            defaults.map((d) => (
              <div key={d.id} data-testid={`rolescope-default-${d.id}`} className="flex items-center gap-3 px-3 py-2">
                <span className="text-apple-12 text-secondary w-40 shrink-0">{SCOPE_LABELS[d.scopeKind]}</span>
                <span className="text-apple-13 text-primary flex-1">{scopeLabel(d)}</span>
                <span className="text-apple-13 text-primary font-medium">{d.roleName}</span>
                <span
                  data-testid={`rolescope-default-state-${d.id}`}
                  className={`text-apple-11 ${d.isDefault ? 'text-verdigris' : 'text-secondary'}`}
                >
                  {d.isDefault ? 'Applied' : 'Offered'}
                </span>
                {canManageRoles && (
                  <button
                    type="button"
                    data-testid={`rolescope-default-clear-${d.id}`}
                    aria-label={`Remove the ${d.roleName} default`}
                    onClick={() => void run(() => clearScopeDefault(d.id))}
                    className="text-secondary hover:text-cinnabar"
                  >
                    <X className="w-4 h-4 stroke-[1.5]" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {canManageRoles && (
          <form
            data-testid="rolescope-default-form"
            className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end"
            onSubmit={(ev) => {
              ev.preventDefault();
              void run(() => setScopeDefault(
                dScope,
                dScope === 'universe' ? dUniverse : null,
                dScope === 'engagement' ? dEngagement : null,
                dRole, true, dReason,
              ));
            }}
          >
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Scope</span>
              <Select
                ariaLabel="Select"
                testId="rolescope-default-scope"
                value={dScope}
                onChange={(v) => setDScope(v as ScopeKind)}
                options={SCOPE_KINDS.map((k) => ({ value: k, label: SCOPE_LABELS[k] }))}
              />
            </label>
            {dScope === 'universe' && (
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Universe</span>
                <Select
                  ariaLabel="Select"
                  testId="rolescope-default-universe"
                  value={dUniverse}
                  onChange={setDUniverse}
                  options={[{ value: '', label: 'Select a universe' }, ...universes.map((u) => ({ value: u.id, label: u.name }))]}
                />
              </label>
            )}
            {dScope === 'engagement' && (
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Engagement</span>
                <Select
                  ariaLabel="Select"
                  testId="rolescope-default-engagement"
                  value={dEngagement}
                  onChange={setDEngagement}
                  options={[{ value: '', label: 'Select an engagement' }, ...engagements.map((e) => ({ value: e.id, label: e.title }))]}
                />
              </label>
            )}
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Role</span>
              <Select
                ariaLabel="Select"
                testId="rolescope-default-role"
                value={dRole}
                onChange={setDRole}
                options={[{ value: '', label: 'Select a role' }, ...roles.map((r) => ({ value: r.slug, label: r.name }))]}
              />
            </label>
            <button
              type="submit"
              data-testid="rolescope-default-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium"
            >
              <Plus className="w-4 h-4 stroke-[1.5]" /> Set default
            </button>
          </form>
        )}
      </section>

      {/* ------------------------------------------------------------------ assignments */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <header className="flex items-center gap-2">
          <Check className="w-4 h-4 text-secondary stroke-[1.5]" />
          <h3 className="text-apple-14 font-semibold text-primary">Role assignments by scope</h3>
        </header>
        <p className="text-apple-12 text-secondary">
          The same person may hold different roles at different scopes. A person can hold more than one
          role at the same scope; the rights add up.
        </p>

        <div data-testid="rolescope-assignments" className="divide-y divide-hairline rounded-xl border border-hairline">
          {assignments.length === 0 ? (
            <p data-testid="rolescope-assignments-empty" className="px-3 py-3 text-apple-12 text-secondary">
              No scoped assignments. Members keep the role on their membership.
            </p>
          ) : (
            assignments.map((a) => {
              const member = members.find((m) => m.userId === a.userId);
              const label = member?.displayName || a.userId.slice(0, 8);
              return (
                <div key={a.id} data-testid={`rolescope-assignment-${a.id}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-apple-13 text-primary w-40 shrink-0 truncate">{label}</span>
                  <span className="text-apple-12 text-secondary w-32 shrink-0">{SCOPE_LABELS[a.scopeKind]}</span>
                  <span className="text-apple-13 text-primary flex-1">{scopeLabel(a)}</span>
                  <span className="text-apple-13 text-primary font-medium">{a.roleName}</span>
                  {a.isDefault && <span data-testid={`rolescope-assignment-default-${a.id}`} className="text-apple-11 text-secondary">from default</span>}
                  {canManageUsers && (
                    <button
                      type="button"
                      data-testid={`rolescope-assignment-remove-${a.id}`}
                      aria-label={`Remove the ${a.roleName} assignment`}
                      onClick={() => void run(() => unassignRole(a.id))}
                      className="text-secondary hover:text-cinnabar"
                    >
                      <X className="w-4 h-4 stroke-[1.5]" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {canManageUsers && (
          <form
            data-testid="rolescope-assign-form"
            className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end"
            onSubmit={(ev) => {
              ev.preventDefault();
              void run(() => assignRole(
                aUser, aScope,
                aScope === 'universe' ? aUniverse : null,
                aScope === 'engagement' ? aEngagement : null,
                aRole || null, '',
              ));
            }}
          >
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Person</span>
              <Select
                ariaLabel="Select"
                testId="rolescope-assign-user"
                value={aUser}
                onChange={setAUser}
                options={[{ value: '', label: 'Select a person' }, ...members.map((m) => ({ value: m.userId, label: m.displayName || m.userId.slice(0, 8) }))]}
              />
            </label>
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Scope</span>
              <Select
                ariaLabel="Select"
                testId="rolescope-assign-scope"
                value={aScope}
                onChange={(v) => setAScope(v as ScopeKind)}
                options={SCOPE_KINDS.map((k) => ({ value: k, label: SCOPE_LABELS[k] }))}
              />
            </label>
            {aScope === 'universe' && (
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Universe</span>
                <Select
                  ariaLabel="Select"
                  testId="rolescope-assign-universe"
                  value={aUniverse}
                  onChange={setAUniverse}
                  options={[{ value: '', label: 'Select a universe' }, ...universes.map((u) => ({ value: u.id, label: u.name }))]}
                />
              </label>
            )}
            {aScope === 'engagement' && (
              <label className="text-apple-12 text-secondary space-y-1">
                <span>Engagement</span>
                <Select
                  ariaLabel="Select"
                  testId="rolescope-assign-engagement"
                  value={aEngagement}
                  onChange={setAEngagement}
                  options={[{ value: '', label: 'Select an engagement' }, ...engagements.map((e) => ({ value: e.id, label: e.title }))]}
                />
              </label>
            )}
            <label className="text-apple-12 text-secondary space-y-1">
              <span>Role</span>
              <Select
                ariaLabel="Select"
                testId="rolescope-assign-role"
                value={aRole}
                onChange={setARole}
                options={[{ value: '', label: 'Use the scope default' }, ...roles.map((r) => ({ value: r.slug, label: r.name }))]}
              />
            </label>
            <button
              type="submit"
              data-testid="rolescope-assign-save"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent-subtle text-primary text-apple-13 font-medium"
            >
              <Plus className="w-4 h-4 stroke-[1.5]" /> Assign
            </button>
          </form>
        )}

        {/* What the chosen scope would give, before the write — the model's answer, shown. */}
        <div data-testid="rolescope-preview" className="rounded-xl border border-hairline px-3 py-2 text-apple-12">
          {previewRoles.length === 0 ? (
            <span data-testid="rolescope-preview-none" className="text-secondary">
              No default applies at this scope. Choose a role, or configure a default first.
            </span>
          ) : (
            <>
              <span data-testid="rolescope-preview-roles" className="text-primary">
                {previewRoles.map(labelFor).join(', ')}
              </span>
              <span className="text-secondary"> confers: </span>
              <span data-testid="rolescope-preview-rights" className="text-primary">
                {previewRights.map((r) => RIGHT_LABELS[r]).join(', ') || 'no rights'}
              </span>
            </>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ effective access */}
      <EffectiveAccessSection
        members={members}
        engagements={engagements}
        engagementUniverse={engagementUniverse}
        labelFor={labelFor}
        defaults={defaults}
        assignments={assignments}
        rightsByRole={rightsByRole}
      />
    </div>
  );
};

/**
 * The resolution, made legible: pick a person and an engagement and see which scope supplied their
 * role and which rights it confers. It shows the pure model's answer AND the database's, so a drift
 * between them is visible on screen rather than only in a test.
 */
const EffectiveAccessSection: React.FC<{
  members: MemberRow[];
  engagements: { id: string; title: string }[];
  engagementUniverse: (id: string) => string | null;
  labelFor: (slug: string) => string;
  defaults: ScopeDefaultView[];
  assignments: RoleAssignmentView[];
  rightsByRole: RightsByRole;
}> = ({ members, engagements, engagementUniverse, labelFor, assignments, rightsByRole }) => {
  const [userId, setUserId] = useState('');
  const [engagementId, setEngagementId] = useState('');
  const [dbAccess, setDbAccess] = useState<{ source: string; roleSlugs: string[]; rights: Record<string, boolean> } | null>(null);

  const member = members.find((m) => m.userId === userId) ?? null;
  const universeId = engagementId ? engagementUniverse(engagementId) : null;

  const local = useMemo(() => {
    if (!userId) return null;
    return resolveAccess(
      assignments, (member?.roleSlug as never) ?? null, rightsByRole, userId,
      universeId, engagementId || null,
    );
  }, [userId, assignments, member, rightsByRole, universeId, engagementId]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) { setDbAccess(null); return; }
    effectiveAccess(userId, engagementId || null)
      .then((r) => { if (!cancelled) setDbAccess(r); })
      .catch(() => { if (!cancelled) setDbAccess(null); });
    return () => { cancelled = true; };
  }, [userId, engagementId]);

  const agrees = !!local && !!dbAccess
    && local.source === dbAccess.source
    && local.roleSlugs.slice().sort().join(',') === dbAccess.roleSlugs.slice().sort().join(',');

  return (
    <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
      <h3 className="text-apple-14 font-semibold text-primary">Effective access</h3>
      <p className="text-apple-12 text-secondary">
        See what a person actually holds. The screen resolves it the same way the database does, so the
        two agree; if they ever disagree, that is shown here rather than hidden.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-apple-12 text-secondary space-y-1">
          <span>Person</span>
          <Select
            ariaLabel="Select"
            testId="rolescope-effective-user"
            value={userId}
            onChange={setUserId}
            options={[{ value: '', label: 'Select a person' }, ...members.map((m) => ({ value: m.userId, label: m.displayName || m.userId.slice(0, 8) }))]}
          />
        </label>
        <label className="text-apple-12 text-secondary space-y-1">
          <span>Engagement</span>
          <Select
            ariaLabel="Select"
            testId="rolescope-effective-engagement"
            value={engagementId}
            onChange={setEngagementId}
            options={[{ value: '', label: 'At the organisation' }, ...engagements.map((e) => ({ value: e.id, label: e.title }))]}
          />
        </label>
      </div>
      <div data-testid="rolescope-effective-result" className="rounded-xl border border-hairline px-3 py-2 text-apple-12 space-y-1">
        {!local ? (
          <span className="text-secondary">Choose a person to see their effective access.</span>
        ) : (
          <>
            <div data-testid="rolescope-effective-reason" className="text-primary">
              {explainAccess(local, labelFor)}
            </div>
            <div data-testid="rolescope-effective-rights" className="text-secondary">
              {RIGHTS.filter((r) => local.rights[r] === true).map((r) => RIGHT_LABELS[r]).join(', ') || 'No rights'}
            </div>
            <div data-testid="rolescope-effective-agrees" className={agrees ? 'text-verdigris' : 'text-cinnabar'}>
              {dbAccess === null
                ? 'The database answer is not available in this session.'
                : agrees
                  ? 'The screen and the database agree.'
                  : `The database answers differently (${dbAccess.source}: ${dbAccess.roleSlugs.join(', ') || 'none'}).`}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
