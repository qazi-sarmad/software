import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Check, AlertTriangle, RefreshCw } from '../common/Icons';
import {
  listCycles,
  listDerivedRisks,
  listErmThemes,
  listKris,
  listPlanChanges,
  listRiskLibrary,
  listStandards,
  proposePlanChange,
  readRiskScore,
  setErmTheme,
  setKriValue,
  writeRiskFactors,
  revertRiskOverride,
  setRiskOverride,
  type CycleRow,
  type ErmThemeRow,
  type KriRow,
  type PlanChangeRow,
  type RiskLibraryRow,
} from '../../data/risk';
import { deriveFactors, type EntityRiskFacts } from '../../lib/risk/derivation';
import { defaultSiraModel, normalizeWeights, siraBandFor } from '../../lib/siraEngine';
import {
  RISK_TAXONOMY_THEMES,
  ermMap,
  kriState,
  planChangeFor,
  type ErmTheme,
  type PlanChangeAction,
  type TriggerKind,
} from '../../lib/risk/dynamicAssessment';

type LoadState = 'loading' | 'ready' | 'empty' | 'error';
type Tab = 'library' | 'autocompute' | 'erm' | 'planning';

/**
 * SR-04 — Risk library and dynamic risk assessment (D14 / D15).
 *
 * The screen surface for the D14 auto-adjusted factors (and their override) and the D15 dynamic
 * assessment: the ERM theme map with its coverage verdicts and gaps, the KRIs against tolerance, and
 * the trigger-based plan-change proposals. The maths is pure (`src/lib/risk/**`); the panel loads the
 * inputs through `src/data/risk.ts`, hands them to the engine and writes the result.
 *
 * S3 owns this file (OWNERSHIP.md §2). Testids use the `risk-` prefix (§5).
 */
const card = 'rounded-2xl border border-hairline bg-surface-elevated p-4';
const btn = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 font-medium hover:bg-surface-elevated disabled:opacity-50';
const input = 'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-apple-12';
const tabCls = (on: boolean) => `px-3 py-1.5 rounded-lg text-apple-12 font-medium ${on ? 'bg-accent text-white' : 'text-secondary hover:bg-surface-elevated'}`;

const bandOf = (v: number) => siraBandFor(v, defaultSiraModel().bands);
const MODEL = defaultSiraModel();
const NORMALISED_WEIGHT_TOTAL = Object.values(
  normalizeWeights(Object.fromEntries(MODEL.factors.map((f) => [f.key, f.weight]))),
).reduce((a, b) => a + b, 0);

/** A deterministic demonstration fact set derived from the risk library row (no clock, no client). */
function factsFor(risk: RiskLibraryRow, classification: string | null, severe: boolean): EntityRiskFacts {
  const n = risk.code.length + risk.name.length;
  return {
    inherentRating: (n % 5) + 1,
    complexityCount: n % 12,
    classification,
    openFindings: n % 5,
    openFindingsSevere: severe ? 1 : 0,
    daysSinceLastAudit: (n * 37) % 800,
    materialityPoint: n % 5 === 0 ? null : (n % 5),
    kriBreaches: n % 3,
    incidentCount: n % 4,
    controlTestFailures: n % 3,
    changeVelocity: n % 8,
  };
}

export const RiskLibraryPanel: React.FC<{ screenId?: string }> = ({ screenId = 'SR-04' }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canWork = hasRight(currentUser, 'manage_engagements') || hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('library');

  const [library, setLibrary] = useState<RiskLibraryRow[]>([]);
  const [derived, setDerived] = useState<{ id: string; code: string; name: string }[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [themes, setThemes] = useState<ErmThemeRow[]>([]);
  const [kris, setKris] = useState<KriRow[]>([]);
  const [proposals, setProposals] = useState<PlanChangeRow[]>([]);
  const [standardsKeys, setStandardsKeys] = useState<string[]>([]);

  const [pickRisk, setPickRisk] = useState('');
  const [pickCycle, setPickCycle] = useState('');
  const [factorValues, setFactorValues] = useState<Record<string, number>>({});
  const [overrideFactor, setOverrideFactor] = useState('');
  const [overrideValue, setOverrideValue] = useState('5');
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [lib, der, cyc, th, kr, pr, std] = await Promise.all([
        listRiskLibrary(orgId), listDerivedRisks(orgId), listCycles(orgId),
        listErmThemes(orgId), listKris(orgId), listPlanChanges(orgId), listStandards(orgId),
      ]);
      setLibrary(lib); setDerived(der); setCycles(cyc); setThemes(th); setKris(kr); setProposals(pr);
      setStandardsKeys(std.map((s) => s.key));
      setPickRisk((cur) => cur || lib[0]?.id || '');
      setPickCycle((cur) => cur || cyc[0]?.id || '');
      setState(lib.length ? 'ready' : 'empty');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The risk library could not be read.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const record = (ok: boolean, reason: string | undefined, okMsg: string) => {
    if (ok) { setNotice(okMsg); setError(null); }
    else { setError(reason ?? 'The action could not be completed.'); setNotice(null); }
  };

  // D14 — derive the factors for the picked risk and write them.
  const runAutoCompute = async () => {
    setBusy('auto'); setNotice(null); setError(null);
    const risk = library.find((r) => r.id === pickRisk);
    const cycle = cycles.find((c) => c.id === pickCycle);
    if (!risk || !cycle) { setBusy(null); setError('Pick a risk and a cycle first.'); return; }
    const classification = 'C6'; // the org's classification governs the exposure factor (D10)
    const proposals = deriveFactors(factsFor(risk, classification, derived.length > 0));
    const res = await writeRiskFactors(orgId, cycle.id, cycle.universeId, risk.id, proposals, []);
    setBusy(null);
    if (!res.ok) { record(false, res.reason, ''); return; }
    const known = proposals.filter((p) => p.proposedValue != null).length;
    setNotice(`Auto-computed ${known}/${proposals.length} factors; score ${res.score} (weights normalised to 100).`);
    const stored = await readRiskScore(orgId, cycle.id, cycle.universeId, risk.id);
    setFactorValues(stored?.factorValues ?? {});
  };

  const saveOverride = async () => {
    setBusy('override'); setNotice(null); setError(null);
    const cycle = cycles.find((c) => c.id === pickCycle);
    if (!cycle) { setBusy(null); setError('Pick a cycle first.'); return; }
    const res = await setRiskOverride(orgId, cycle.id, cycle.universeId, pickRisk, overrideFactor, Number(overrideValue), overrideReason);
    setBusy(null);
    record(res.ok, res.ok ? undefined : res.reason, `Override recorded for ${overrideFactor} (auto value kept).`);
  };

  const revertOverride = async () => {
    setBusy('revert'); setNotice(null); setError(null);
    const cycle = cycles.find((c) => c.id === pickCycle);
    if (!cycle) { setBusy(null); setError('Pick a cycle first.'); return; }
    const res = await revertRiskOverride(orgId, cycle.id, cycle.universeId, pickRisk, overrideFactor);
    setBusy(null);
    record(res.ok, res.ok ? undefined : res.reason, `Override reverted for ${overrideFactor}.`);
  };

  // D15 — the ERM map from the stored themes.
  const ermThemes: ErmTheme[] = useMemo(() => themes.map((t) => ({
    theme: t.theme, isTopRisk: t.isTopRisk,
    mappedEntities: t.entityId ? [t.entityId] : [],
    engagements: [],
    kris: kris.filter((k) => k.theme === t.theme).map((k) => ({ id: k.kriId, value: k.value, tolerance: k.tolerance })),
  })), [themes, kris]);

  const map = useMemo(() => ermMap(ermThemes), [ermThemes]);

  const [triggerKind, setTriggerKind] = useState<TriggerKind>('kri_breach');
  const [triggerEntity, setTriggerEntity] = useState('');
  const propose = async () => {
    setBusy('propose'); setNotice(null); setError(null);
    const proposal = planChangeFor({ kind: triggerKind, detail: triggerEntity, entity: triggerEntity }, false);
    const res = await proposePlanChange(orgId, triggerKind, null, proposal.action, proposal.rationale);
    setBusy(null);
    record(res.ok, res.ok ? undefined : res.reason, `Proposed: ${proposal.action} — ${proposal.rationale}`);
    await load();
  };

  if (state === 'loading') {
    return <div className={card} data-testid="risk-loading"><RefreshCw className="h-4 w-4 animate-spin" /> Reading the risk library…</div>;
  }
  if (state === 'error') {
    return <div className={card} data-testid="risk-error"><InlineError message={loadError} /></div>;
  }

  return (
    <section className="space-y-4" data-testid="risk-panel" data-screen={screenId}>
      <header className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5" />
        <h2 className="text-apple-16 font-semibold">Risk library &amp; dynamic assessment</h2>
      </header>

      {notice && <div className="rounded-xl border border-hairline bg-surface-elevated p-3 text-apple-12" data-testid="risk-notice">{notice}</div>}
      {error && <InlineError message={error} />}
      {!canWork && (
        <div className="rounded-xl border border-hairline p-3 text-apple-12 text-secondary" data-testid="risk-denied">
          You do not hold the manage_engagements or edit_config right, so this screen is read-only.
        </div>
      )}

      <nav className="flex flex-wrap gap-1" data-testid="risk-tabs">
        {(['library', 'autocompute', 'erm', 'planning'] as Tab[]).map((t) => (
          <button key={t} className={tabCls(tab === t)} data-testid={`risk-tab-${t}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {tab === 'library' && (
        <div className={card} data-testid="risk-library">
          <h3 className="text-apple-14 font-semibold">Risk library ({library.length})</h3>
          <p className="mt-1 text-apple-11 text-secondary">
            The universal, organisation and discipline rows; the derived rows name the framework they came from.
          </p>
          <ul className="mt-2 space-y-1">
            {library.map((r) => (
              <li key={r.id} className="text-apple-12" data-testid={`risk-library-row-${r.id}`}>
                <span className="font-medium">{r.code || '—'}</span> {r.name}
                <span className="text-apple-11 text-secondary"> · {r.discipline || 'universal'} · {r.source || 'no source'}</span>
              </li>
            ))}
          </ul>
          {derived.length > 0 && (
            <p className="mt-2 text-apple-12" data-testid="risk-library-derived-count">
              <Check className="inline h-4 w-4" /> {derived.length} framework-derived risks
            </p>
          )}
        </div>
      )}

      {tab === 'autocompute' && (
        <div className={card} data-testid="risk-autocompute">
          <h3 className="text-apple-14 font-semibold">Auto-compute (D14)</h3>
          <p className="mt-1 text-apple-11 text-secondary">
            Every auto-derived value is a proposal named and versioned; an unknown input is unknown, never 0.
            The factor weights normalise to exactly 100.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-apple-12">Risk
              <select className={input} data-testid="risk-pick" value={pickRisk} onChange={(e) => setPickRisk(e.target.value)}>
                {library.map((r) => <option key={r.id} value={r.id}>{r.code || r.name}</option>)}
              </select>
            </label>
            <label className="text-apple-12">Cycle
              <select className={input} data-testid="risk-cycle" value={pickCycle} onChange={(e) => setPickCycle(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{c.year} ({c.status})</option>)}
              </select>
            </label>
          </div>
          <button className={`${btn} mt-3`} data-testid="risk-autocompute-run" onClick={runAutoCompute} disabled={!canWork || busy !== null || !cycles.length}>
            <RefreshCw className="h-4 w-4" /> Auto-compute factors
          </button>
          {Object.keys(factorValues).length > 0 && (
            <>
              <ul className="mt-2 space-y-1" data-testid="risk-factor-values">
                {Object.entries(factorValues).map(([k, v]) => (
                  <li key={k} className="text-apple-12" data-testid={`risk-factor-${k}`}>{k}: {v} ({bandOf(v)})</li>
                ))}
              </ul>
              <p className="mt-2 text-apple-11 text-secondary" data-testid="risk-weights">
                Weights normalised to {NORMALISED_WEIGHT_TOTAL}/100
              </p>
            </>
          )}

          <div className="mt-4 border-t border-hairline pt-3">
            <h4 className="text-apple-12 font-medium">Manual override</h4>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-apple-12">Factor
                <select className={input} data-testid="risk-override-factor" value={overrideFactor} onChange={(e) => setOverrideFactor(e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(factorValues).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label className="text-apple-12">Value
                <input className={input} type="number" min={1} max={5} data-testid="risk-override-value" value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} />
              </label>
              <label className="text-apple-12">Reason (mandatory)
                <input className={input} data-testid="risk-override-reason" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
              </label>
            </div>
            <div className="mt-2 flex gap-2">
              <button className={btn} data-testid="risk-override-save" onClick={saveOverride} disabled={!canWork || busy !== null || !overrideFactor}>Record override</button>
              <button className={btnGhost} data-testid="risk-override-revert" onClick={revertOverride} disabled={!canWork || busy !== null || !overrideFactor}>Revert</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'erm' && (
        <div className={card} data-testid="risk-erm">
          <h3 className="text-apple-14 font-semibold">ERM coverage map (D15)</h3>
          <p className="mt-1 text-apple-11 text-secondary">
            Each enterprise risk theme mapped to its coverage verdict; a top risk with no coverage is a gap.
          </p>
          {map.gaps.length > 0 && (
            <p className="mt-2 text-apple-12" data-testid="risk-erm-gaps">
              <AlertTriangle className="inline h-4 w-4" /> {map.gaps.length} top risk(s) uncovered: {map.gaps.map((g) => g.theme).join(', ')}
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {map.rows.map((r) => (
              <li key={r.theme} className="text-apple-12" data-testid={`risk-erm-${r.theme}`}>
                <span className="font-medium">{r.theme}</span>: {r.verdict}
                <span className="block text-apple-11 text-secondary">{r.reason}</span>
              </li>
            ))}
            {map.rows.length === 0 && (
              <li className="text-apple-12 text-secondary" data-testid="risk-erm-empty">No ERM themes are mapped yet.</li>
            )}
          </ul>
          <div className="mt-3 border-t border-hairline pt-3">
            <h4 className="text-apple-12 font-medium">KRIs against tolerance</h4>
            <ul className="mt-1 space-y-1">
              {kris.map((k) => {
                const s = kriState(k.value, k.tolerance);
                return (
                  <li key={k.kriId} className="text-apple-12" data-testid={`risk-kri-${k.kriId}`}>
                    {k.kriId}: {k.value ?? 'unknown'} / {k.tolerance ?? 'no tolerance'} — {s}
                  </li>
                );
              })}
              {kris.length === 0 && <li className="text-apple-12 text-secondary" data-testid="risk-kri-empty">No KRIs recorded.</li>}
            </ul>
            {canWork && (
              <button className={`${btnGhost} mt-2`} data-testid="risk-kri-add" disabled={busy !== null}
                onClick={async () => {
                  const id = `KRI-${kris.length + 1}`;
                  const res = await setKriValue(orgId, id, RISK_TAXONOMY_THEMES[0], null, null);
                  record(res.ok, res.ok ? undefined : res.reason, `${id} recorded as unknown (no value, no tolerance).`);
                  await load();
                }}>Add an unmeasured KRI</button>
            )}
          </div>
        </div>
      )}

      {tab === 'planning' && (
        <div className={card} data-testid="risk-planning">
          <h3 className="text-apple-14 font-semibold">Continuous planning (D15)</h3>
          <p className="mt-1 text-apple-11 text-secondary">
            A trigger produces a plan-change proposal with a rationale (track / defer / cancel / rescope).
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-apple-12">Trigger
              <select className={input} data-testid="risk-trigger-kind" value={triggerKind} onChange={(e) => setTriggerKind(e.target.value as TriggerKind)}>
                <option value="kri_breach">KRI breach</option>
                <option value="incident">Incident</option>
                <option value="management_request">Management request</option>
                <option value="strategic_change">Strategic change</option>
              </select>
            </label>
            <label className="text-apple-12">Entity / topic
              <input className={input} data-testid="risk-trigger-entity" value={triggerEntity} onChange={(e) => setTriggerEntity(e.target.value)} />
            </label>
          </div>
          <button className={`${btn} mt-3`} data-testid="risk-propose" onClick={propose} disabled={!canWork || busy !== null || !triggerEntity}>
            Propose a plan change
          </button>
          <ul className="mt-2 space-y-1">
            {proposals.map((p) => (
              <li key={p.id} className="text-apple-12" data-testid={`risk-proposal-${p.id}`}>
                <span className="font-medium">{p.action}</span> ({p.triggerKind}): {p.rationale}
              </li>
            ))}
            {proposals.length === 0 && <li className="text-apple-12 text-secondary" data-testid="risk-proposals-empty">No plan-change proposals yet.</li>}
          </ul>
        </div>
      )}
    </section>
  );
};
