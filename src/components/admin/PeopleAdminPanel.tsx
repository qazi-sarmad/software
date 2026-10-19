import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight, RIGHTS, type Right } from '../../lib/rights';
import {
  createRole,
  deleteRole,
  grantScope,
  inviteUser,
  listMembers,
  listRoles,
  listScopes,
  provisionMember,
  revokeScope,
  setMemberManager,
  setMemberRole,
  setInviteCap,
  updateRoleRights,
  type AdminResult,
  type MemberRow,
  type RoleRow,
  type ScopeRow,
} from '../../data/admin';
import { Select } from '../common/Select';
import { Check, Minus, Plus, User, Users, XCircle } from '../common/Icons';
import { HoldToConfirm } from '../common/HoldToConfirm';

type Tab = 'people' | 'roles';
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
  use_ai_assist: 'Use AI assist',
  view_insights: 'View insights',
};

function ErrorBanner({ result, onDismiss }: { result: AdminResult | null; onDismiss: () => void }) {
  if (!result || result.ok) return null;
  return (
    <div
      role="alert"
      data-testid="admin-error"
      className="flex items-start gap-2 rounded-xl border border-cinnabar bg-cinnabar-subtle px-3 py-2 text-apple-12 text-primary"
    >
      <XCircle className="w-4 h-4 text-cinnabar stroke-[1.5] mt-0.5 shrink-0" />
      <span className="flex-1">{result.reason}</span>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-secondary hover:text-primary">
        ×
      </button>
    </div>
  );
}

/**
 * People & Roles (spec §23). Visual administration of users, roles, scopes and reporting lines.
 * Every control is gated by a right (hasRight), never a role name. Every save writes through an
 * RPC in migration 0017, which re-checks the right in the database.
 */
export const PeopleAdminPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canManageUsers = hasRight(currentUser, 'manage_users');
  const canManageRoles = hasRight(currentUser, 'manage_roles');

  const [tab, setTab] = useState<Tab>(canManageUsers ? 'people' : 'roles');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [result, setResult] = useState<AdminResult | null>(null);

  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newUser, setNewUser] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteSentTo, setInviteSentTo] = useState<string | null>(null);
  const [inviteCap, setInviteCapValue] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [m, r, s] = await Promise.all([
        canManageUsers ? listMembers() : Promise.resolve([]),
        listRoles(),
        canManageUsers ? listScopes() : Promise.resolve([]),
      ]);
      setMembers(m);
      setRoles(r);
      setScopes(s);
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The administration data could not be loaded.');
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

  const sendInvite = async () => {
    const email = inviteEmail.trim();
    const r = await run(() => inviteUser(email, inviteRole || null));
    if (r.ok) {
      setInviteSentTo(email);
      setInviteEmail('');
      setInviteRole('');
    }
  };

  const toggleRight = (slug: string, right: Right, current: boolean) => {
    const row = roles.find((x) => x.slug === slug);
    if (!row) return;
    void run(() => updateRoleRights(slug, { ...row.rights, [right]: !current }));
  };

  if (state === 'loading') {
    return (
      <div data-testid="admin-loading" className="p-6 text-apple-13 text-secondary">
        Loading people and roles…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div data-testid="admin-load-error" className="p-6 space-y-3">
        <p className="text-apple-13 text-primary">The administration data could not be loaded.</p>
        <p className="text-apple-12 text-secondary">{loadError}</p>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 rounded-xl bg-accent text-white text-apple-12 font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const roleOptions = roles.map((r) => ({ value: r.slug, label: r.name }));

  return (
    <div className="p-6 space-y-6" data-testid="people-admin-panel">
      <div className="border-b border-hairline pb-3">
        <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">Administration</span>
        <h3 className="text-apple-20 font-bold text-primary mt-1">People &amp; Roles</h3>
        <p className="text-apple-12 text-secondary mt-1">
          Users, roles, scopes and reporting lines. Every change is versioned and logged.
        </p>
      </div>

      <ErrorBanner result={result} onDismiss={() => setResult(null)} />

      <div className="flex gap-1 bg-surface-hover rounded-xl p-1 w-fit" role="tablist">
        {canManageUsers && (
          <button
            role="tab"
            aria-selected={tab === 'people'}
            onClick={() => setTab('people')}
            className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold ${tab === 'people' ? 'bg-surface text-primary shadow-xs' : 'text-secondary'}`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1.5 stroke-[1.5]" />
            People
          </button>
        )}
        <button
          role="tab"
          aria-selected={tab === 'roles'}
          onClick={() => setTab('roles')}
          className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold ${tab === 'roles' ? 'bg-surface text-primary shadow-xs' : 'text-secondary'}`}
        >
          <User className="w-3.5 h-3.5 inline mr-1.5 stroke-[1.5]" />
          Roles &amp; rights
        </button>
      </div>

      {tab === 'people' && canManageUsers && (
        <section data-testid="admin-people" className="space-y-5">
          <div className="rounded-xl border border-hairline overflow-hidden">
            <table className="w-full text-apple-12">
              <thead className="bg-surface-hover text-secondary">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Name</th>
                  <th className="text-left px-3 py-2 font-semibold">Role</th>
                  <th className="text-left px-3 py-2 font-semibold">Reports to</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-secondary" data-testid="admin-people-empty">
                      No members yet.
                    </td>
                  </tr>
                )}
                {members.map((m) => (
                  <tr key={m.userId} className="border-t border-hairline" data-testid={`member-${m.userId}`}>
                    <td className="px-3 py-2 text-primary">{m.displayName || m.userId}</td>
                    <td className="px-3 py-2">
                      <Select
                        ariaLabel={`Role for ${m.displayName || m.userId}`}
                        value={m.roleSlug}
                        options={roleOptions}
                        onChange={(v) => void run(() => setMemberRole(m.userId, v))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        ariaLabel={`Manager for ${m.displayName || m.userId}`}
                        value={m.managerId ?? ''}
                        options={[
                          { value: '', label: 'No manager' },
                          ...members
                            .filter((o) => o.userId !== m.userId)
                            .map((o) => ({ value: o.userId, label: o.displayName || o.userId })),
                        ]}
                        onChange={(v) => void run(() => setMemberManager(m.userId, v || null))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-hairline p-4 space-y-3">
            <h4 className="text-apple-13 font-semibold text-primary">Invite a colleague</h4>
            <p className="text-apple-11 text-secondary">
              Enter the email address and the role to grant. They can sign in once their account is created.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                aria-label="Enter email address"
                type="email"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteSentTo(null); }}
                placeholder="Enter email address"
                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <Select
                ariaLabel="Select role"
                value={inviteRole}
                options={[{ value: '', label: 'Select role' }, ...roleOptions]}
                onChange={(v) => setInviteRole(v)}
                className="sm:w-56"
              />
              <button
                data-testid="admin-invite"
                disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail.trim())}
                onClick={() => void sendInvite()}
                className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-semibold disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1 stroke-[1.5]" />
                Send invite
              </button>
            </div>
            {inviteSentTo && (
              <p data-testid="admin-invite-sent" className="text-apple-12 text-verdigris">
                Invitation sent to {inviteSentTo}
              </p>
            )}
          </div>

          <details className="rounded-xl border border-hairline p-4 space-y-3">
            <summary className="text-apple-13 font-semibold text-primary cursor-pointer">
              Provision an existing account
            </summary>
            <p className="text-apple-11 text-secondary mt-3">
              Use this only when the user already has a sign-in. Enter the account id and the role to grant.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mt-3">
              <input
                aria-label="Account id"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder="Account id (uuid)"
                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <input
                aria-label="Display name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Display name"
                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <input
                aria-label="Role slug"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="Role slug"
                className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <button
                data-testid="admin-provision"
                disabled={!newUser || !newSlug}
                onClick={() => void run(() => provisionMember(newUser, newName, newSlug))}
                className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-semibold disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1 stroke-[1.5]" />
                Provision
              </button>
            </div>
          </details>

          <div className="rounded-xl border border-hairline p-4 space-y-3">
            <h4 className="text-apple-13 font-semibold text-primary">Scopes</h4>
            <p className="text-apple-11 text-secondary">
              {scopes.length} scope {scopes.length === 1 ? 'row' : 'rows'} granted in this organisation.
            </p>
            <ul className="space-y-1" data-testid="admin-scopes">
              {scopes.length === 0 && <li className="text-apple-12 text-secondary">No scopes granted.</li>}
              {scopes.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-apple-12 text-primary">
                  <span>
                    {members.find((m) => m.userId === s.userId)?.displayName || s.userId} ·{' '}
                    {s.universeId ? `universe ${s.universeId}` : s.entityId ? `entity ${s.entityId}` : `engagement ${s.engagementId}`}
                  </span>
                  <button
                    aria-label={`Revoke scope ${s.id}`}
                    onClick={() => void run(() => revokeScope(s.id))}
                    className="text-cinnabar hover:opacity-80"
                  >
                    <Minus className="w-3.5 h-3.5 stroke-[1.5]" />
                  </button>
                </li>
              ))}
            </ul>
            <button
              data-testid="admin-grant-scope"
              onClick={() => void run(() => grantScope(currentUser.id, null, null, null))}
              className="px-3 py-1.5 rounded-xl border border-hairline text-apple-12 text-primary"
            >
              Grant a scope to myself
            </button>
          </div>

          <div className="rounded-xl border border-hairline p-4 space-y-3">
            <h4 className="text-apple-13 font-semibold text-primary">Invitation cap</h4>
            <div className="flex gap-2 items-center">
              <input
                aria-label="Per-user daily invitation cap"
                value={inviteCap}
                onChange={(e) => setInviteCapValue(e.target.value)}
                inputMode="numeric"
                placeholder="1–100"
                className="w-28 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
              />
              <button
                data-testid="admin-set-cap"
                disabled={!/^\d+$/.test(inviteCap)}
                onClick={() => void run(() => setInviteCap(Number(inviteCap)))}
                className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-semibold disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'roles' && (
        <section data-testid="admin-roles" className="space-y-5">
          {!canManageRoles && (
            <p className="text-apple-12 text-secondary" data-testid="admin-roles-readonly">
              You can view roles but not change them.
            </p>
          )}
          <div className="rounded-xl border border-hairline overflow-x-auto">
            <table className="w-full text-apple-11">
              <thead className="bg-surface-hover text-secondary">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Role</th>
                  {RIGHTS.map((r) => (
                    <th key={r} className="px-2 py-2 font-semibold text-center whitespace-nowrap">
                      {RIGHT_LABELS[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-t border-hairline" data-testid={`role-${role.slug}`}>
                    <td className="px-3 py-2 text-primary font-semibold whitespace-nowrap">{role.name}</td>
                    {RIGHTS.map((r) => {
                      const held = role.rights[r] === true;
                      return (
                        <td key={r} className="px-2 py-2 text-center">
                          <button
                            aria-label={`${RIGHT_LABELS[r]} for ${role.name}`}
                            aria-pressed={held}
                            disabled={!canManageRoles}
                            onClick={() => toggleRight(role.slug, r, held)}
                            className={`w-5 h-5 rounded-md inline-flex items-center justify-center border ${
                              held ? 'bg-accent border-accent text-white' : 'border-hairline text-transparent'
                            } disabled:opacity-50`}
                          >
                            <Check className="w-3 h-3 stroke-[2]" />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {canManageRoles && (
            <div className="rounded-xl border border-hairline p-4 space-y-3">
              <h4 className="text-apple-13 font-semibold text-primary">Create a role</h4>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  aria-label="New role name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
                />
                <input
                  aria-label="New role slug"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="slug_lowercase"
                  className="flex-1 px-3 py-2 rounded-xl bg-surface border border-hairline text-apple-12 text-primary"
                />
                <button
                  data-testid="admin-create-role"
                  disabled={!newName || !/^[a-z][a-z0-9_]*$/.test(newSlug)}
                  onClick={() => void run(() => createRole(newName, newSlug, {}))}
                  className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-semibold disabled:opacity-50"
                >
                  Create
                </button>
              </div>
              {roles.some((r) => !r.isSeed) && (
                <ul className="space-y-1 pt-2 border-t border-hairline">
                  {roles
                    .filter((r) => !r.isSeed)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between text-apple-12 text-primary">
                        <span>{r.name}</span>
                        <HoldToConfirm
                          label={`Delete role ${r.name}`}
                          testId={`admin-delete-role-${r.slug}`}
                          durationMs={2000}
                          onConfirm={() => void run(() => deleteRole(r.slug))}
                          className="relative overflow-hidden text-cinnabar hover:opacity-80 transition-opacity"
                        >
                          <Minus className="w-3.5 h-3.5 stroke-[1.5]" />
                        </HoldToConfirm>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
