import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import {
  getArchivedFileRole, setArchivedFileRole, listArchivedFileCustodians, listCustodianRoles,
  type ArchivedFileCustodianRow, type ArchivedFileRole, type CustodianRoleOption,
} from '../../data/fileOwnership';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import { Check, Lock, ShieldCheck, Archive } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-41 — archived-file custodian role (owner 2026-10-30).
 *
 * "For archived files add a permanently configurable role." An archived file outlives the person who
 * owned it, so its custodian is a ROLE the organisation chooses, not a person. This surface makes
 * that choice, and the choice is permanent in two senses: every change is versioned and appended to
 * the ledger, and the configuration itself can never be deleted. The lower half shows every archived
 * file with its custodian role and the person who owned it, so the setting is visibly in force.
 *
 * Non-blocking, keyboard-first, gated by `manage_roles` (the database re-checks). No JSON is accepted
 * anywhere: the reason is prose, and every option is a role the tenant already has.
 */
export const ArchivedFileRolePanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-41' }) => {
  const { currentUser } = useApp();
  const canManage = hasRight(currentUser, 'manage_roles');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [role, setRole] = useState<ArchivedFileRole | null>(null);
  const [archives, setArchives] = useState<ArchivedFileCustodianRow[]>([]);
  const [roles, setRoles] = useState<CustodianRoleOption[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [r, a, ro] = await Promise.all([
        getArchivedFileRole(), listArchivedFileCustodians(), listCustodianRoles(),
      ]);
      setRole(r);
      setArchives(a);
      setRoles(ro);
      setDraft(r?.roleSlug ?? ro[0]?.slug ?? 'cia');
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the custodian configuration.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const roleLabel = useCallback(
    (slug: string) => roles.find((r) => r.slug === slug)?.name ?? slug,
    [roles],
  );

  const changed = useMemo(
    () => Boolean(role) && draft !== role?.roleSlug,
    [draft, role],
  );
  const reasonTooShort = reason.trim().length < 10;

  const save = useCallback(async () => {
    if (!canManage || !changed || reasonTooShort) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const version = await setArchivedFileRole(draft, reason.trim());
      setNotice(
        `${roleLabel(draft)} is now the custodian role for archived files (version ${version ?? '—'}). Every archived file from now on names this role.`,
      );
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The custodian role could not be changed.');
    } finally {
      setBusy(false);
    }
  }, [canManage, changed, draft, reason, reasonTooShort, load, roleLabel]);

  return (
    <section data-testid="archived-role-panel" data-screen={screenId} className="space-y-5">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 stroke-[1.5] text-accent" />
          <h2 className="text-apple-15 font-semibold text-primary">Archived files — custodian role</h2>
        </div>
        <p className="text-apple-12 text-secondary max-w-2xl">
          An archived file outlives the person who owned it. Its custodian is a role the organisation
          chooses here; the choice is versioned, recorded in the ledger, and can never be deleted, so
          there is always someone accountable for an archive.
        </p>
      </header>

      <InlineError message={state === 'error' ? loadError : null} testId="archived-role-load-error" />

      {state === 'loading' && (
        <p data-testid="archived-role-loading" className="text-apple-12 text-secondary">Loading…</p>
      )}

      {state === 'ready' && (
        <>
          <div
            data-testid="archived-role-current"
            className="rounded-2xl border border-hairline bg-surface p-4 space-y-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 stroke-[1.5] text-verdigris" />
                <span className="text-apple-13 text-secondary">Custodian role in force</span>
              </div>
              <span
                data-testid="archived-role-version"
                className="text-apple-12 text-secondary tabular-nums"
              >
                version {role?.version ?? 1}
                {role?.isDefault ? ' · platform default' : ''}
              </span>
            </div>
            <p data-testid="archived-role-value" className="text-apple-17 font-semibold text-primary">
              {role ? roleLabel(role.roleSlug) : '—'}
            </p>
            {role?.reason && (
              <p data-testid="archived-role-reason" className="text-apple-12 text-secondary">
                {role.reason}
              </p>
            )}
          </div>

          {!canManage && (
            <p
              data-testid="archived-role-readonly"
              className="flex items-center gap-2 rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-12 text-secondary"
            >
              <Lock className="w-4 h-4 stroke-[1.5]" />
              You can read the custodian role. Changing it needs the <code>manage_roles</code> right.
            </p>
          )}

          {canManage && (
            <form
              data-testid="archived-role-form"
              className="rounded-2xl border border-hairline bg-surface p-4 space-y-3"
              onSubmit={(e) => { e.preventDefault(); void save(); }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-apple-12 text-secondary">Custodian role</span>
                  <Select
                    testId="archived-role-select"
                    ariaLabel="Custodian role for archived files"
                    value={draft}
                    onChange={setDraft}
                    options={roles.map((r) => ({ value: r.slug, label: r.name, hint: r.why }))}
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-apple-12 text-secondary">
                    Reason <span className="text-secondary">(at least 10 characters)</span>
                  </span>
                  <input
                    data-testid="archived-role-reason-input"
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why the custodian moves"
                    className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-13 text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                </label>
              </div>
              <p data-testid="archived-role-why" className="text-apple-12 text-secondary">
                {roles.find((r) => r.slug === draft)?.why ?? ''}
              </p>
              <div className="flex items-center justify-between gap-3">
                <p className="text-apple-12 text-secondary">
                  A change is a new version and is written to the ledger. The configuration is never deleted.
                </p>
                <button
                  type="submit"
                  data-testid="archived-role-save"
                  disabled={busy || !changed || reasonTooShort}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-apple-13 font-medium text-white disabled:opacity-40"
                >
                  <Check className="w-4 h-4 stroke-[1.5]" />
                  {busy ? 'Saving…' : 'Set custodian role'}
                </button>
              </div>
            </form>
          )}

          <InlineError message={error || null} testId="archived-role-error" />
          {notice && (
            <p
              data-testid="archived-role-notice"
              className="rounded-xl border border-verdigris bg-verdigris-subtle px-3 py-2 text-apple-12 text-primary"
            >
              {notice}
            </p>
          )}

          <div data-testid="archived-role-archives" className="space-y-2">
            <h3 className="text-apple-13 font-medium text-primary">Archived files</h3>
            {archives.length === 0 ? (
              <p data-testid="archived-role-archives-empty" className="text-apple-12 text-secondary">
                No file has been archived yet. When one is, it will name its custodian role here.
              </p>
            ) : (
              <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
                {archives.map((a) => (
                  <li
                    key={a.archiveId}
                    data-testid={`archived-role-archive-${a.archiveId}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
                  >
                    <span className="text-apple-13 text-primary">{a.custodianRoleName || roleLabel(a.custodianRoleSlug)}</span>
                    <span className="text-apple-12 text-secondary">
                      owner {a.ownerName || '—'}
                    </span>
                    <span className="text-apple-12 text-secondary tabular-nums">
                      {a.archivedRowCount} rows · {a.status}
                    </span>
                    <span className="text-apple-12 text-secondary font-mono">
                      {a.contentHash.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};
