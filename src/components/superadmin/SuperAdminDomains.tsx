import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listUniversesWithDiscipline, seedDefaultUniverses, setUniverseDomain, universeDiscipline,
  type UniverseDisciplineRow,
} from '../../data/platformDomains';
import { listTenants, type TenantRow } from '../../data/platform';
import { DISCIPLINE_PROFILES, selectableDisciplines } from '../../lib/risk/domains';
import { disciplineRuleBase } from '../../lib/systeligon';
import { InlineError } from '../common/InlineError';
import { Check, Plus, Shield, AlertTriangle } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-19 — audit domains and their rule bases (D11, docs/AUDIT-DOMAINS-MODEL.md).
 *
 * The surface `universes.domain` never had. It seeds the three default universes (Management /
 * Shari'ah / IT), sets a universe's discipline with a reason (validated and ledgered server-side),
 * and shows the rule base each discipline runs — the rule count, the rule ids and every standard or
 * control id they cite, read from the engine's own base so the screen cannot claim a rule it does not
 * have.
 *
 * Never hard-codes exactly three: the profile list is the closed-but-extensible set, and an
 * org-defined discipline is offered as a value to type. A universe whose `domain` is unknown reads as
 * "not set" rather than being silently mapped to a default.
 */
export const SuperAdminDomains: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [targetOrg, setTargetOrg] = useState('');
  const [universes, setUniverses] = useState<UniverseDisciplineRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The server's answer to `universe_discipline`, keyed by universe id (the read-back proof). */
  const [verified, setVerified] = useState<Record<string, string | null>>({});

  // The per-universe discipline editor.
  const [editing, setEditing] = useState<string>('');
  const [domainDraft, setDomainDraft] = useState<string>('management');
  const [reasonDraft, setReasonDraft] = useState<string>('');

  const loadTenants = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const rows = await listTenants();
      setTenants(rows);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the tenants.');
      setState('error');
    }
  }, []);

  useEffect(() => { void loadTenants(); }, [loadTenants]);

  const loadUniverses = useCallback(async () => {
    if (!targetOrg) { setUniverses([]); setVerified({}); return; }
    try {
      const rows = await listUniversesWithDiscipline();
      setUniverses(rows);
      // Read each universe's discipline back through the server RPC, so the screen shows the value
      // the database holds, not only the value in the list read.
      const answers = await Promise.all(rows.map(async (r) => [r.id, await universeDiscipline(r.id)] as const));
      setVerified(Object.fromEntries(answers));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the universes.');
      setUniverses([]);
      setVerified({});
    }
  }, [targetOrg]);

  useEffect(() => { void loadUniverses(); }, [loadUniverses]);

  /** The rule base of each selectable discipline, read from the engine so the counts cannot drift. */
  const ruleBases = useMemo(
    () => selectableDisciplines().map((p) => ({ profile: p, base: disciplineRuleBase(p.discipline) })),
    [],
  );

  const seed = async () => {
    if (!targetOrg) { setError('Choose a tenant first.'); return; }
    setBusy('seed');
    setError(null);
    setNotice(null);
    const res = await seedDefaultUniverses(targetOrg);
    if (!res.ok) setError(res.reason);
    else setNotice(res.added > 0
      ? `Seeded ${res.added} default universe${res.added === 1 ? '' : 's'}.`
      : 'All three default universes already exist — nothing was added.');
    await loadUniverses();
    setBusy(null);
  };

  const saveDomain = async () => {
    if (!editing) { setError('Choose a universe to re-discipline.'); return; }
    if (!reasonDraft.trim()) { setError('A reason is required to change a discipline.'); return; }
    setBusy('domain');
    setError(null);
    setNotice(null);
    const res = await setUniverseDomain(editing, domainDraft.trim().toLowerCase(), reasonDraft.trim());
    if (!res.ok) setError(res.reason);
    else setNotice(`Universe re-disciplined to ${domainDraft.trim().toLowerCase()}.`);
    setEditing('');
    setReasonDraft('');
    await loadUniverses();
    setBusy(null);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="sa-domains-loading">Loading the audit domains…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="sa-domains-error" />
        <button type="button" onClick={() => void loadTenants()} className="text-apple-12 text-accent hover:underline" data-testid="sa-domains-retry">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="sa-domains">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" /> Audit domains and their rule bases
        </h2>
        <p className="text-apple-12 text-secondary">
          A universe carries a discipline; the discipline carries a rule base. The three defaults are a
          seed, not a limit — an organisation may define a fourth and point it at its own pack.
        </p>
      </header>

      {/* The tenant whose universes are shown. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-domains-target">
        <h3 className="text-apple-13 font-semibold text-primary">Organisation</h3>
        <div className="flex flex-wrap gap-2">
          <select
            value={targetOrg} onChange={(e) => setTargetOrg(e.target.value)}
            aria-label="Target organisation" data-testid="sa-domains-org-select"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          >
            <option value="">Choose an organisation…</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            type="button" disabled={busy !== null || !targetOrg} onClick={() => void seed()}
            data-testid="sa-domains-seed"
            className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5 inline" /> Seed the three defaults
          </button>
        </div>
      </section>

      {targetOrg && (
        <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-domains-list">
          <h3 className="text-apple-13 font-semibold text-primary">Universes</h3>
          {universes.length === 0 ? (
            <p className="text-apple-12 text-secondary" data-testid="sa-domains-empty">
              This organisation has no universe yet. Seed the three defaults, or create one in the org.
            </p>
          ) : (
            <table className="w-full text-apple-12">
              <thead>
                <tr className="text-left text-secondary">
                  <th className="py-1">Universe</th>
                  <th className="py-1">Discipline</th>
                  <th className="py-1">Read back</th>
                  <th className="py-1">Rule base</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {universes.map((u) => {
                  const profile = u.discipline ? DISCIPLINE_PROFILES.find((p) => p.discipline === u.discipline) : undefined;
                  const base = u.discipline ? disciplineRuleBase(u.discipline) : null;
                  return (
                    <tr key={u.id} className="border-t border-hairline" data-testid={`sa-domains-row-${u.id}`}>
                      <td className="py-2 text-primary">{u.name}</td>
                      <td className="py-2 text-secondary">
                        {profile ? profile.label : (
                          <span className="inline-flex items-center gap-1 text-cinnabar" data-testid={`sa-domains-unset-${u.id}`}>
                            <AlertTriangle className="w-3 h-3" /> {u.domain ? `unknown: ${u.domain}` : 'not set'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-secondary" data-testid={`sa-domains-readback-${u.id}`}>
                        {verified[u.id] ?? '—'}
                      </td>
                      <td className="py-2 text-secondary" data-testid={`sa-domains-base-${u.id}`}>
                        {base ? `${base.ruleCount} rule(s)` : '—'}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button" onClick={() => { setEditing(u.id); setDomainDraft(u.discipline ?? 'management'); setReasonDraft(''); }}
                          data-testid={`sa-domains-edit-${u.id}`}
                          className="text-apple-12 text-accent hover:underline"
                        >
                          Set discipline
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {editing && (
            <div className="rounded-xl border border-hairline bg-canvas p-3 space-y-2" data-testid="sa-domains-editor">
              <p className="text-apple-12 text-secondary">Set the discipline for the selected universe.</p>
              <div className="flex flex-wrap gap-2">
                <input
                  list="sa-domains-disciplines" value={domainDraft}
                  onChange={(e) => setDomainDraft(e.target.value)}
                  aria-label="Discipline" data-testid="sa-domains-domain-input"
                  className="rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-12"
                />
                <datalist id="sa-domains-disciplines">
                  {selectableDisciplines().map((p) => <option key={p.discipline} value={p.discipline}>{p.label}</option>)}
                </datalist>
                <input
                  type="text" value={reasonDraft} onChange={(e) => setReasonDraft(e.target.value)}
                  placeholder="Reason (required)" aria-label="Reason" data-testid="sa-domains-reason"
                  className="flex-1 min-w-40 rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-12"
                />
                <button
                  type="button" disabled={busy !== null} onClick={() => void saveDomain()}
                  data-testid="sa-domains-save"
                  className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button" onClick={() => { setEditing(''); setReasonDraft(''); }}
                  data-testid="sa-domains-cancel"
                  className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {notice && <p className="text-apple-12 text-verdigris" data-testid="sa-domains-notice">{notice}</p>}
          {error && <InlineError message={error} testId="sa-domains-action-error" />}
        </section>
      )}

      {/* The rule base each discipline runs, read from the engine. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-domains-bases">
        <h3 className="text-apple-13 font-semibold text-primary">Rule bases</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {ruleBases.map(({ profile, base }) => (
            <div key={profile.discipline} className="rounded-xl border border-hairline bg-canvas p-3 space-y-2"
                 data-testid={`sa-domains-basecard-${profile.discipline}`}>
              <h4 className="text-apple-13 font-medium text-primary flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-verdigris" /> {profile.label}
              </h4>
              <p className="text-apple-11 text-secondary" data-testid={`sa-domains-basecount-${profile.discipline}`}>
                {base.ruleCount} released rule{base.ruleCount === 1 ? '' : 's'}
              </p>
              <ul className="text-apple-11 text-secondary space-y-0.5">
                {profile.controlStandards.map((s) => <li key={s}>• {s}</li>)}
              </ul>
              {base.standards.length > 0 && (
                <p className="text-apple-11 text-secondary" data-testid={`sa-domains-basestandards-${profile.discipline}`}>
                  Cites: {base.standards.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
