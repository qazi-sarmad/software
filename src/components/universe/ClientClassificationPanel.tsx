import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Check, Shield, AlertTriangle, RefreshCw } from '../common/Icons';
import {
  listClassificationObligations,
  listDerivedRisks,
  listStandards,
  readClassification,
  setClassification,
  updateStandard,
  deriveRisks,
  type ObligationRow,
  type OrgClassificationRead,
  type StandardRow,
  type DerivedRiskRow,
} from '../../data/risk';
import { CLASSIFICATIONS } from '../../lib/risk/classification';
import { platformWhoami } from '../../data/platform';
import { selectableDisciplines } from '../../lib/risk/domains';
import type { Discipline } from '../../lib/risk/domains';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/**
 * OA-37 — Client classification (D10).
 *
 * The screen surface for the C1–C8 classification and the configurable standards/framework library.
 * The classification is a switch: it shows whether internal audit and ICFR are mandatory and at what
 * rigour, the frameworks and artifacts the regime requires, and the disciplines it offers. The
 * standards library is editable per org, for every org at once, or as the platform default, and the
 * frameworks' risks can be derived into the org's SIRA risk library.
 *
 * S3 owns this file (OWNERSHIP.md §2). Testids use the `classification-` prefix (§5).
 */
const card = 'rounded-2xl border border-hairline bg-surface-elevated p-4';
const btn = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 font-medium hover:bg-surface-elevated disabled:opacity-50';
const input = 'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-12';

export const ClientClassificationPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-37' }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canEdit = hasRight(currentUser, 'edit_config');
  // The platform administrator is decided by the platform whoami, never by a role name in the JWT.
  const [isPlatform, setIsPlatform] = useState(false);

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [current, setCurrent] = useState<OrgClassificationRead | null>(null);
  const [obligations, setObligations] = useState<ObligationRow[]>([]);
  const [standards, setStandards] = useState<StandardRow[]>([]);
  const [derived, setDerived] = useState<DerivedRiskRow[]>([]);

  const [pick, setPick] = useState('C1');
  const [isIslamic, setIsIslamic] = useState(false);
  const [hasItScope, setHasItScope] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const c = await readClassification(orgId);
      setCurrent(c);
      setObligations(c ? await listClassificationObligations(orgId) : []);
      setStandards(await listStandards(orgId));
      setDerived(await listDerivedRisks(orgId));
      setState(c ? 'ready' : 'empty');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The classification could not be read.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let live = true;
    platformWhoami().then((who) => { if (live) setIsPlatform(who.isPlatformAdmin); }).catch(() => { if (live) setIsPlatform(false); });
    return () => { live = false; };
  }, []);

  const record = (ok: boolean, reason: string | undefined, okMsg: string) => {
    if (ok) { setNotice(okMsg); setError(null); }
    else { setError(reason ?? 'The action could not be completed.'); setNotice(null); }
  };

  const saveClassification = async () => {
    setBusy('classify'); setNotice(null); setError(null);
    const res = await setClassification(orgId, pick, isIslamic, hasItScope);
    setBusy(null);
    record(res.ok, res.ok ? undefined : res.reason, `Classification ${pick} saved.`);
    await load();
  };

  const derive = async () => {
    setBusy('derive'); setNotice(null); setError(null);
    const res = await deriveRisks(orgId, null);
    setBusy(null);
    record(res.ok, res.reason, `Derived ${res.added ?? 0} framework risks into the risk library.`);
    await load();
  };

  const saveStandard = async (s: StandardRow, scope: 'platform' | 'org' | 'all_orgs', label: string) => {
    setBusy(`${s.key}:${scope}`); setNotice(null); setError(null);
    const res = await updateStandard({
      scope, orgId: scope === 'org' ? orgId : null, key: s.key, discipline: s.discipline,
      label, citation: s.citation, source: s.source,
    });
    setBusy(null);
    record(res.ok, res.ok ? undefined : res.reason, `${s.key} updated for ${scope}.`);
    await load();
  };

  if (state === 'loading') {
    return <div className={card} data-testid="classification-loading"><RefreshCw className="h-4 w-4 animate-spin" /> Reading the classification…</div>;
  }
  if (state === 'error') {
    return <div className={card} data-testid="classification-error"><InlineError message={loadError} /></div>;
  }

  return (
    <section className="space-y-4" data-testid="classification-panel" data-screen={screenId}>
      <header className="flex items-center gap-2">
        <Shield className="h-5 w-5" />
        <h2 className="text-apple-16 font-semibold">Client classification</h2>
      </header>

      {notice && <div className="rounded-xl border border-hairline bg-surface-elevated p-3 text-apple-12" data-testid="classification-notice">{notice}</div>}
      {error && <InlineError message={error} />}

      {!canEdit && (
        <div className="rounded-xl border border-hairline p-3 text-apple-12 text-secondary" data-testid="classification-denied">
          You do not hold the edit_config right, so this screen is read-only.
        </div>
      )}

      {/* The current classification, or the empty state. */}
      {state === 'empty' ? (
        <div className={card} data-testid="classification-empty">
          <p className="text-apple-12 text-secondary">No classification has been set for this organisation yet.</p>
        </div>
      ) : current && (
        <div className={card} data-testid="classification-current">
          <div className="flex items-baseline justify-between">
            <h3 className="text-apple-14 font-semibold">{current.classification} — {current.profile?.name}</h3>
            <span className="text-apple-11 text-secondary" data-testid="classification-version">v{current.version}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-apple-12">
            <dt className="text-secondary">Regulator</dt><dd data-testid="classification-regulator">{current.profile?.regulator}</dd>
            <dt className="text-secondary">Internal audit</dt>
            <dd data-testid="classification-ia">{current.internalAuditConditional ? 'Conditional' : current.internalAuditMandatory ? 'Mandatory' : 'Exempt'}</dd>
            <dt className="text-secondary">ICFR</dt>
            <dd data-testid="classification-icfr">{current.icfrMandatory ? `Mandatory (${current.icfrRigour})` : 'Not mandatory'}</dd>
            <dt className="text-secondary">Numbering cited</dt><dd data-testid="classification-numbering">{current.regulatorNumbering}</dd>
            <dt className="text-secondary">Offered disciplines</dt>
            <dd data-testid="classification-disciplines">{current.offeredDisciplines.join(', ')}</dd>
          </dl>
          {current.frameworks.length > 0 && (
            <p className="mt-2 text-apple-12" data-testid="classification-frameworks">Frameworks: {current.frameworks.join(' · ')}</p>
          )}
          {current.artifacts.length > 0 && (
            <p className="mt-1 text-apple-12" data-testid="classification-artifacts">Artifacts: {current.artifacts.join(' · ')}</p>
          )}
        </div>
      )}

      {/* The obligations, each citing its clause. */}
      {obligations.length > 0 && (
        <div className={card} data-testid="classification-obligations">
          <h3 className="text-apple-14 font-semibold">Obligations</h3>
          <ul className="mt-2 space-y-1">
            {obligations.map((o) => (
              <li key={o.obligationId} className="text-apple-12" data-testid={`classification-obligation-${o.obligationId}`}>
                <span className="font-medium">{o.obligationId}</span> — {o.subject}
                <span className="block text-apple-11 text-secondary">{o.sourceClause}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Set the classification. */}
      <div className={card} data-testid="classification-set">
        <h3 className="text-apple-14 font-semibold">Set the classification</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-apple-12">
            Classification
            <select className={input} data-testid="classification-pick" value={pick} onChange={(e) => setPick(e.target.value)} disabled={!canEdit}>
              {CLASSIFICATIONS.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-apple-12">
            <input type="checkbox" data-testid="classification-islamic" checked={isIslamic} onChange={(e) => setIsIslamic(e.target.checked)} disabled={!canEdit} />
            Islamic / Shari'ah obligation
          </label>
          <label className="flex items-center gap-2 text-apple-12">
            <input type="checkbox" data-testid="classification-it" checked={hasItScope} onChange={(e) => setHasItScope(e.target.checked)} disabled={!canEdit} />
            Has technology scope
          </label>
        </div>
        <button className={`${btn} mt-3`} data-testid="classification-save" onClick={saveClassification} disabled={!canEdit || busy !== null}>
          <Check className="h-4 w-4" /> Save classification
        </button>
      </div>

      {/* The configurable standards library. */}
      <div className={card} data-testid="classification-standards">
        <h3 className="text-apple-14 font-semibold">Standards &amp; frameworks library</h3>
        <p className="mt-1 text-apple-11 text-secondary">
          Each row is the platform default, or this organisation's own configuration of it. Update it for
          this organisation alone, or — as platform administrator — for every organisation at once.
        </p>
        <ul className="mt-2 space-y-2">
          {standards.map((s) => (
            <li key={s.key} className="rounded-xl border border-hairline p-2 text-apple-12" data-testid={`classification-standard-${s.key}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.label}</span>
                <span className="text-apple-11 text-secondary" data-testid={`classification-standard-scope-${s.key}`}>
                  {s.overridden ? `org override v${s.version}` : `platform default v${s.version}`}
                </span>
              </div>
              <p className="mt-1 text-apple-11 text-secondary">{s.citation}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={btnGhost} data-testid={`classification-standard-org-${s.key}`} disabled={!canEdit || busy !== null}
                  onClick={() => saveStandard(s, 'org', `${s.label} (this organisation)`)}>This org</button>
                <button className={btnGhost} data-testid={`classification-standard-platform-${s.key}`} disabled={!isPlatform || busy !== null}
                  onClick={() => saveStandard(s, 'platform', s.label)}>Platform default</button>
                <button className={btnGhost} data-testid={`classification-standard-all-${s.key}`} disabled={!isPlatform || busy !== null}
                  onClick={() => saveStandard(s, 'all_orgs', `${s.label} (all organisations)`)}>All orgs</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Derive the framework risks into SIRA. */}
      <div className={card} data-testid="classification-derive">
        <h3 className="text-apple-14 font-semibold">Derive risks from the frameworks</h3>
        <p className="mt-1 text-apple-11 text-secondary">
          Materialise the risks each framework's control requirements imply into this organisation's SIRA
          risk library, for the disciplines the classification offers. The derivation is idempotent.
        </p>
        <button className={`${btn} mt-3`} data-testid="classification-derive-run" onClick={derive}
          disabled={!canEdit || busy !== null || !current}>
          <RefreshCw className="h-4 w-4" /> Derive risks
        </button>
        {derived.length > 0 && (
          <p className="mt-2 text-apple-12" data-testid="classification-derived-count">
            <Check className="inline h-4 w-4" /> {derived.length} framework risks in the library
          </p>
        )}
        {derived.length === 0 && current && (
          <p className="mt-2 text-apple-12 text-secondary" data-testid="classification-derived-empty">
            <AlertTriangle className="inline h-4 w-4" /> No framework risks derived yet.
          </p>
        )}
      </div>
    </section>
  );
};
