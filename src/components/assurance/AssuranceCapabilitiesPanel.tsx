import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Check, Shield, AlertTriangle, RefreshCw } from '../common/Icons';
import {
  listIcfrConfig,
  runIcfrMonitoring,
  runForensicAnalytics,
  runGapAnalysis,
  runAssuranceOverAssurance,
  saveIcfrControl,
  saveIcfrRule,
  saveIcfrEvidence,
  saveAssuranceMetric,
  type IcfrConfigRead,
} from '../../data/assurance';
import { FORENSIC_RULES } from '../../lib/assurance/forensicAnalytics';
import { SEVERITY_LADDER, TAXONOMIES, ASSERTIONS, COSO_COMPONENTS, type ControlMonitoringResult } from '../../lib/assurance/controlMonitoring';
import type { GapAnalysisResult } from '../../lib/assurance/gapAnalysis';
import type { AssuranceOverAssuranceResult } from '../../lib/assurance/assuranceOverAssurance';
import { IIA_STANDARDS } from '../../lib/assurance/assuranceOverAssurance';

type Tab = 'd5' | 'd7' | 'd8' | 'd9';
type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-34 — Assurance capabilities (D5 / D7 / D8 / D9).
 *
 * The screen surface for the four owner-approved assurance capabilities. Each has a pure engine under
 * `src/lib/assurance/**`; this panel loads its inputs through `src/data/assurance.ts`, hands them to
 * the engine, shows the result, and records the findings through the capability's writer. Nothing here
 * is generated text and nothing calls out — every classification is a rule over the configured
 * thresholds, and a control with no evidence is shown as NOT a pass.
 *
 * S2 owns this file (OWNERSHIP.md §2). Testids use the `assurance-` prefix (§5).
 */
const card = 'rounded-2xl border border-hairline bg-surface-elevated p-4';
const btn = 'inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50';
const tabCls = (on: boolean) => `px-3 py-1.5 rounded-lg text-apple-12 font-medium ${on ? 'bg-accent text-white' : 'text-secondary hover:bg-surface-elevated'}`;

/** The COSO component ids in the same order as the taxonomy's group labels. */
const COSO_COMPONENT_IDS = COSO_COMPONENTS.map((c) => c.id);

export const AssuranceCapabilitiesPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-34' }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canWork = hasRight(currentUser, 'perform_work') || hasRight(currentUser, 'review_and_approve');
  const canEdit = hasRight(currentUser, 'edit_config');

  const [tab, setTab] = useState<Tab>('d5');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // D5 state.
  const [icfr, setIcfr] = useState<IcfrConfigRead | null>(null);
  const [d5, setD5] = useState<ControlMonitoringResult | null>(null);
  // D7 state.
  const [populationId, setPopulationId] = useState('');
  const [d7, setD7] = useState<{ ruleId: string; flaggedCount: number; source: string; reason: string }[] | null>(null);
  // D8 state.
  const [d8, setD8] = useState<GapAnalysisResult | null>(null);
  // D9 state.
  const [d9, setD9] = useState<AssuranceOverAssuranceResult | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      setIcfr(await listIcfrConfig(orgId));
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'The assurance configuration could not be read.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const nowIso = () => new Date().toISOString();
  const record = (res: { ok: boolean; reason?: string }, okMsg: string) => {
    if (res.ok) { setNotice(okMsg); setError(null); }
    else { setError(res.reason ?? 'The finding could not be recorded.'); setNotice(null); }
  };

  const runD5 = async () => {
    setBusy('d5'); setNotice(null); setError(null);
    try {
      const { result, recorded } = await runIcfrMonitoring(orgId, null, nowIso());
      setD5(result);
      record(recorded, `Monitored ${result.rows.length} control(s): ${result.breaches.length} breach(es).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The monitoring run failed.'); }
    finally { setBusy(null); }
  };

  const runD7 = async () => {
    setBusy('d7'); setNotice(null); setError(null);
    try {
      const { results, recorded } = await runForensicAnalytics(orgId, populationId, null, nowIso(), FORENSIC_RULES);
      setD7(results.map((r) => ({ ruleId: r.ruleId, flaggedCount: r.flaggedCount, source: r.source, reason: r.reason })));
      record(recorded, `Ran ${results.length} forensic rule(s).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The forensic run failed.'); }
    finally { setBusy(null); }
  };

  const runD8 = async () => {
    setBusy('d8'); setNotice(null); setError(null);
    try {
      const { result, recorded } = await runGapAnalysis(orgId);
      setD8(result);
      record(recorded, `Coverage ${result.coveragePercent}% over ${result.rows.length} clause(s); ${result.gaps.length} gap(s).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The gap analysis failed.'); }
    finally { setBusy(null); }
  };

  const runD9 = async () => {
    setBusy('d9'); setNotice(null); setError(null);
    try { setD9(await runAssuranceOverAssurance(orgId, nowIso().slice(0, 10))); }
    catch (e) { setError(e instanceof Error ? e.message : 'The assurance measurement failed.'); }
    finally { setBusy(null); }
  };

  // D5 configuration: a control, its monitoring rule and its test evidence.
  const [ctl, setCtl] = useState({ controlId: '', component: 'control_activities', principle: 12, assertion: 'completeness', owner: '', testProcedure: '' });
  const [tolerance, setTolerance] = useState('5');
  const [evi, setEvi] = useState({ population: '', deviations: '' });

  const saveControl = async () => {
    setBusy('ctl'); setNotice(null); setError(null);
    try {
      const res = await saveIcfrControl({
        orgId, controlId: ctl.controlId, taxonomy: 'coso_icif_2013', component: ctl.component,
        principle: Number(ctl.principle), assertion: ctl.assertion, owner: ctl.owner, testProcedure: ctl.testProcedure,
      });
      record(res, `Control ${ctl.controlId} saved.`);
      if (res.ok) await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'The control could not be saved.'); }
    finally { setBusy(null); }
  };

  const saveRule = async () => {
    setBusy('rule'); setNotice(null); setError(null);
    try {
      const res = await saveIcfrRule({ orgId, ruleId: `icfr.${ctl.controlId}`, ruleVersion: 1, controlId: ctl.controlId, tolerancePercent: Number(tolerance) });
      record(res, `Rule for ${ctl.controlId} saved (tolerance ${tolerance}%).`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The rule could not be saved.'); }
    finally { setBusy(null); }
  };

  const saveEvidence = async () => {
    setBusy('evi'); setNotice(null); setError(null);
    try {
      const res = await saveIcfrEvidence({ orgId, controlId: ctl.controlId, population: Number(evi.population), deviations: Number(evi.deviations), testedAt: nowIso() });
      record(res, `Evidence for ${ctl.controlId} saved.`);
      if (res.ok) await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'The evidence could not be saved.'); }
    finally { setBusy(null); }
  };

  // D9 configuration: an IIA-2024 metric. An empty value is saved as NULL (unknown), never 0.
  const [metric, setMetric] = useState({ metricId: '', standard: '12.2', label: '', value: '' });

  const saveMetric = async () => {
    setBusy('metric'); setNotice(null); setError(null);
    try {
      const res = await saveAssuranceMetric({
        orgId, metricId: metric.metricId, standard: metric.standard, label: metric.label,
        value: metric.value.trim() === '' ? null : Number(metric.value),
      });
      record(res, `Metric ${metric.metricId} saved${metric.value.trim() === '' ? ' as unknown (no value)' : ''}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'The metric could not be saved.'); }
    finally { setBusy(null); }
  };


  if (state === 'loading') return <div data-testid="assurance-loading" className={card}>Loading assurance configuration…</div>;
  if (state === 'error') {
    return (
      <div data-testid="assurance-error" className={card}>
        <InlineError message={loadError} testId="assurance-error-message" />
        <button type="button" className={btn} data-testid="assurance-retry" onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div data-testid="assurance-panel" data-screen={screenId} className="space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-accent" />
        <h2 className="text-apple-14 font-semibold text-primary">Assurance capabilities</h2>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {([['d5', 'ICFR monitoring'], ['d7', 'Forensic analytics'], ['d8', 'Gap analysis'], ['d9', 'Assurance over assurance']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t}
            className={tabCls(tab === t)} data-testid={`assurance-tab-${t}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {notice && <div data-testid="assurance-notice" className="text-apple-12 text-verdigris">{notice}</div>}
      <InlineError message={error} testId="assurance-run-error" />

      {tab === 'd5' && (
        <div className={card} data-testid="assurance-d5">
          <div className="text-apple-12 text-secondary mb-2">
            {icfr?.controls.length ?? 0} control(s) configured over {TAXONOMIES.length} taxonomies; {icfr?.rules.length ?? 0} rule(s), {icfr?.evidence.length ?? 0} evidence set(s).
          </div>
          <button type="button" className={btn} disabled={busy === 'd5' || !canWork}
            data-testid="assurance-d5-run" onClick={() => void runD5()}>
            <RefreshCw className="w-3.5 h-3.5" /> Monitor controls
          </button>
          {!canWork && <span className="ml-2 text-apple-11 text-secondary" data-testid="assurance-d5-needs-right">perform_work or review_and_approve is required to record a finding.</span>}

          {canEdit && (
            <div className="mt-3 space-y-2 border-t border-hairline pt-3" data-testid="assurance-d5-config">
              <div className="text-apple-12 text-secondary">Configure a control, its monitoring rule and its test evidence.</div>
              <div className="flex flex-wrap gap-2">
                <input data-testid="assurance-d5-control-id" aria-label="Control id" value={ctl.controlId}
                  onChange={(e) => setCtl({ ...ctl, controlId: e.target.value })} placeholder="Control id (e.g. C-01)"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <select data-testid="assurance-d5-component" aria-label="COSO component" value={ctl.component}
                  onChange={(e) => setCtl({ ...ctl, component: e.target.value })}
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent">
                  {TAXONOMIES.find((t) => t.id === 'coso_icif_2013')!.groups.map((g, i) => <option key={g} value={COSO_COMPONENT_IDS[i]}>{g}</option>)}
                </select>
                <select data-testid="assurance-d5-assertion" aria-label="Assertion" value={ctl.assertion}
                  onChange={(e) => setCtl({ ...ctl, assertion: e.target.value })}
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent">
                  {ASSERTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
                <input data-testid="assurance-d5-owner" aria-label="Owner" value={ctl.owner}
                  onChange={(e) => setCtl({ ...ctl, owner: e.target.value })} placeholder="Owner"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <input data-testid="assurance-d5-procedure" aria-label="Test procedure" value={ctl.testProcedure}
                  onChange={(e) => setCtl({ ...ctl, testProcedure: e.target.value })} placeholder="Test procedure"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <button type="button" className={btn} disabled={busy === 'ctl' || ctl.controlId.trim() === ''}
                  data-testid="assurance-d5-save-control" onClick={() => void saveControl()}>Save control</button>
              </div>
              <div className="flex flex-wrap gap-2">
                <input data-testid="assurance-d5-tolerance" aria-label="Tolerance percent" value={tolerance}
                  onChange={(e) => setTolerance(e.target.value)} placeholder="Tolerance %"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <button type="button" className={btn} disabled={busy === 'rule' || ctl.controlId.trim() === ''}
                  data-testid="assurance-d5-save-rule" onClick={() => void saveRule()}>Save rule</button>
                <input data-testid="assurance-d5-population" aria-label="Population" value={evi.population}
                  onChange={(e) => setEvi({ ...evi, population: e.target.value })} placeholder="Population"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <input data-testid="assurance-d5-deviations" aria-label="Deviations" value={evi.deviations}
                  onChange={(e) => setEvi({ ...evi, deviations: e.target.value })} placeholder="Deviations"
                  className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
                <button type="button" className={btn} disabled={busy === 'evi' || ctl.controlId.trim() === ''}
                  data-testid="assurance-d5-save-evidence" onClick={() => void saveEvidence()}>Save evidence</button>
              </div>
            </div>
          )}

          {d5 && (
            <div className="mt-3 space-y-2" data-testid="assurance-d5-result">
              <div className="text-apple-12" data-testid="assurance-d5-complete">
                {d5.complete ? 'Every configured control has evidence and a rule.' : 'Some controls are unmonitored or have no evidence — NOT a pass.'}
              </div>
              {d5.breaches.length > 0 && (
                <ul data-testid="assurance-d5-breaches" className="space-y-1">
                  {d5.breaches.map((b) => (
                    <li key={`${b.controlId}-${b.ruleId}`} data-testid={`assurance-d5-breach-${b.controlId}`} className="text-apple-12">
                      <AlertTriangle className="inline w-3.5 h-3.5 text-cinnabar" /> {b.controlId}: {b.severity} — {b.basis} (rule {b.ruleId} v{b.ruleVersion})
                    </li>
                  ))}
                </ul>
              )}
              {d5.noEvidence.length > 0 && (
                <div data-testid="assurance-d5-no-evidence" className="text-apple-12 text-cinnabar">
                  No evidence: {d5.noEvidence.join(', ')}
                </div>
              )}
              {d5.unmonitored.length > 0 && (
                <div data-testid="assurance-d5-unmonitored" className="text-apple-12 text-cinnabar">
                  Unmonitored (no rule): {d5.unmonitored.join(', ')}
                </div>
              )}
              {d5.rows.length === 0 && <div data-testid="assurance-d5-empty" className="text-apple-12 text-secondary">No controls are configured yet.</div>}
              <div className="text-apple-11 text-secondary" data-testid="assurance-d5-ladder">
                Ladder: {SEVERITY_LADDER.map((s) => s.severity).join(' → ')}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'd7' && (
        <div className={card} data-testid="assurance-d7">
          <label className="text-apple-12 text-secondary block mb-1" htmlFor="assurance-d7-population">Population id</label>
          <input id="assurance-d7-population" data-testid="assurance-d7-population" value={populationId}
            onChange={(e) => setPopulationId(e.target.value)} placeholder="the locked population to analyse"
            className="h-9 w-full px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
          <button type="button" className={`${btn} mt-2`} disabled={busy === 'd7' || !canWork || populationId.trim() === ''}
            data-testid="assurance-d7-run" onClick={() => void runD7()}>
            <RefreshCw className="w-3.5 h-3.5" /> Run forensic rules
          </button>
          {d7 && (
            <div className="mt-3" data-testid="assurance-d7-result">
              {d7.length === 0
                ? <div data-testid="assurance-d7-empty" className="text-apple-12 text-secondary">No rules were run.</div>
                : (
                  <ul data-testid="assurance-d7-findings" className="space-y-1">
                    {d7.map((r) => (
                      <li key={r.ruleId} data-testid={`assurance-d7-finding-${r.ruleId}`} className="text-apple-12">
                        {r.flaggedCount > 0 ? <AlertTriangle className="inline w-3.5 h-3.5 text-cinnabar" /> : <Check className="inline w-3.5 h-3.5 text-verdigris" />}{' '}
                        {r.ruleId}: {r.flaggedCount} flagged — {r.source}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
        </div>
      )}

      {tab === 'd8' && (
        <div className={card} data-testid="assurance-d8">
          <button type="button" className={btn} disabled={busy === 'd8' || !canWork}
            data-testid="assurance-d8-run" onClick={() => void runD8()}>
            <RefreshCw className="w-3.5 h-3.5" /> Analyse coverage
          </button>
          {d8 && (
            <div className="mt-3 space-y-2" data-testid="assurance-d8-result">
              <div className="text-apple-12" data-testid="assurance-d8-coverage">Coverage {d8.coveragePercent}% over {d8.rows.length} clause(s).</div>
              {d8.gaps.length > 0 && (
                <ul data-testid="assurance-d8-gaps" className="space-y-1">
                  {d8.gaps.map((g) => (
                    <li key={g.obligationId} data-testid={`assurance-d8-gap-${g.obligationId}`} className="text-apple-12">
                      <AlertTriangle className="inline w-3.5 h-3.5 text-cinnabar" /> {g.sourceClause}: {g.reason}
                    </li>
                  ))}
                </ul>
              )}
              {d8.notInterpreted.length > 0 && (
                <div data-testid="assurance-d8-unknown" className="text-apple-12 text-cinnabar">
                  Could not interpret: {d8.notInterpreted.map((r) => r.sourceClause).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'd9' && (
        <div className={card} data-testid="assurance-d9">
          <button type="button" className={btn} disabled={busy === 'd9'}
            data-testid="assurance-d9-run" onClick={() => void runD9()}>
            <RefreshCw className="w-3.5 h-3.5" /> Measure the function
          </button>
          {canEdit && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3" data-testid="assurance-d9-config">
              <input data-testid="assurance-d9-metric-id" aria-label="Metric id" value={metric.metricId}
                onChange={(e) => setMetric({ ...metric, metricId: e.target.value })} placeholder="Metric id"
                className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
              <select data-testid="assurance-d9-standard" aria-label="IIA standard" value={metric.standard}
                onChange={(e) => setMetric({ ...metric, standard: e.target.value })}
                className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent">
                {IIA_STANDARDS.map((s) => <option key={s.standard} value={s.standard}>{s.standard} {s.title}</option>)}
              </select>
              <input data-testid="assurance-d9-label" aria-label="Metric label" value={metric.label}
                onChange={(e) => setMetric({ ...metric, label: e.target.value })} placeholder="Label"
                className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
              <input data-testid="assurance-d9-value" aria-label="Metric value" value={metric.value}
                onChange={(e) => setMetric({ ...metric, value: e.target.value })} placeholder="Value (blank = unknown)"
                className="h-9 px-3 rounded-xl bg-surface border border-hairline text-apple-13 text-primary outline-none focus:border-accent" />
              <button type="button" className={btn} disabled={busy === 'metric' || metric.metricId.trim() === ''}
                data-testid="assurance-d9-save-metric" onClick={() => void saveMetric()}>Save metric</button>
            </div>
          )}
          {d9 && (
            <div className="mt-3 space-y-2" data-testid="assurance-d9-result">
              <div className="text-apple-12" data-testid="assurance-d9-summary">{d9.measured} measured, {d9.unknown} unknown (as at {d9.asOf}).</div>
              <ul className="space-y-1">
                {d9.rows.map((r) => (
                  <li key={r.metricId} data-testid={`assurance-d9-metric-${r.metricId}`} className="text-apple-12">
                    {r.state === 'measured' ? <Check className="inline w-3.5 h-3.5 text-verdigris" /> : <AlertTriangle className="inline w-3.5 h-3.5 text-cinnabar" />}{' '}
                    IIA {r.standard}: {r.label} — {r.state === 'measured' ? r.value : 'unknown'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
